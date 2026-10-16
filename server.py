"""A small local web server for the Pomodoro timer's browser UI.

Run it with:  python server.py   (then open http://127.0.0.1:8000)

The countdown runs in the browser (a React app in frontend/, built into static/).
This server only serves those built files and a tiny JSON API, reusing storage.py and summary.py, so the CLI and the web UI read and
write the same sessions.json.

API
    GET  /api/summary?week=0     weekly stats (same numbers as `main.py summary`)
    GET  /api/sessions?n=10      most recent sessions, newest first
    POST /api/sessions           log one work session (JSON body)
"""

import argparse
import json
import threading
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from storage import DEFAULT_PATH, append_session, load_sessions
from summary import DAY_NAMES, build_summary

STATIC_DIR = (Path(__file__).parent / "static").resolve()

# The React build (frontend/ -> static/) has file names like assets/index-3f9a1c.js.
# Anything not listed here is sent as plain bytes.
CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".woff": "font/woff",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def static_file(url_path):
    """Map a URL path to a file inside static/, or None.

    resolve() follows any '..' parts, and the relative_to() check rejects
    anything that ends up outside static/, so /../storage.py can't be read.
    """
    if url_path in ("", "/"):
        url_path = "/index.html"
    candidate = (STATIC_DIR / url_path.lstrip("/")).resolve()
    try:
        candidate.relative_to(STATIC_DIR)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


MAX_LABEL_LENGTH = 40
MAX_BODY_BYTES = 10_000

# ThreadingHTTPServer handles requests in parallel; this lock stops two saves
# from reading the same file and one overwriting the other's new session.
write_lock = threading.Lock()


def parse_session(data):
    """Validate a POSTed session and return a clean record, or raise ValueError."""
    if not isinstance(data, dict):
        raise ValueError("Body must be a JSON object.")

    label = str(data.get("label", "")).strip() or "general"
    if len(label) > MAX_LABEL_LENGTH:
        raise ValueError(f"Label must be {MAX_LABEL_LENGTH} characters or fewer.")

    try:
        start = datetime.fromisoformat(data["start"])
        end = datetime.fromisoformat(data["end"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("start and end must be ISO timestamps like 2026-10-16T09:00:00.")
    if end < start:
        raise ValueError("end can't be before start.")

    minutes = data.get("minutes")
    if isinstance(minutes, bool) or not isinstance(minutes, (int, float)) or minutes <= 0:
        raise ValueError("minutes must be a positive number.")
    # Focus minutes can be less than end - start (pauses), but never more.
    wall_minutes = (end - start).total_seconds() / 60
    if minutes > wall_minutes + 0.1:
        raise ValueError("minutes can't be longer than the time between start and end.")

    completed = data.get("completed")
    if not isinstance(completed, bool):
        raise ValueError("completed must be true or false.")

    return {
        "label": label,
        "start": start.isoformat(timespec="seconds"),
        "end": end.isoformat(timespec="seconds"),
        "minutes": round(minutes, 2),
        "type": "work",
        "completed": completed,
    }


def summary_to_json(summary):
    """Convert build_summary()'s dates into strings so it can go out as JSON."""
    return {
        "monday": summary["monday"].isoformat(),
        "sunday": summary["sunday"].isoformat(),
        "total_minutes": round(summary["total_minutes"], 2),
        "completed": summary["completed"],
        "abandoned": summary["abandoned"],
        "streak": summary["streak"],
        "per_day": [
            {"day": name, "date": day.isoformat(), "minutes": round(mins, 2)}
            for name, (day, mins) in zip(DAY_NAMES, summary["per_day"].items())
        ],
        "per_label": [
            {"label": label, "minutes": round(mins, 2)}
            for label, mins in summary["per_label"].items()
        ],
    }


class PomodoroHandler(BaseHTTPRequestHandler):
    """Routes requests to the static files or the JSON API."""

    sessions_path = DEFAULT_PATH  # tests point this at a temp file

    # --- helpers ---------------------------------------------------------

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json({"error": message}, status)

    def query_int(self, query, name, default):
        """Read an integer query parameter, e.g. ?week=-1."""
        try:
            return int(query.get(name, [default])[0])
        except ValueError:
            raise ValueError(f"{name} must be a whole number.")

    # --- routes ----------------------------------------------------------

    def do_GET(self):
        url = urlparse(self.path)
        query = parse_qs(url.query)

        if not url.path.startswith("/api/"):
            path = static_file(url.path)
            if path is None:
                self.send_error_json(HTTPStatus.NOT_FOUND, "Not found.")
                return
            body = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", CONTENT_TYPES.get(path.suffix, "application/octet-stream"))
            self.send_header("Content-Length", str(len(body)))
            # Built assets have a content hash in the name, so they can be cached forever.
            if "/assets/" in url.path:
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
            self.end_headers()
            self.wfile.write(body)
            return

        try:
            if url.path == "/api/summary":
                week = self.query_int(query, "week", 0)
                summary = build_summary(load_sessions(self.sessions_path), week)
                self.send_json(summary_to_json(summary))
            elif url.path == "/api/sessions":
                n = max(1, min(self.query_int(query, "n", 10), 100))
                sessions = sorted(load_sessions(self.sessions_path),
                                  key=lambda s: s["start"], reverse=True)
                self.send_json(sessions[:n])
            else:
                self.send_error_json(HTTPStatus.NOT_FOUND, "Not found.")
        except ValueError as err:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(err))

    def do_POST(self):
        if urlparse(self.path).path != "/api/sessions":
            self.send_error_json(HTTPStatus.NOT_FOUND, "Not found.")
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Send a JSON body under 10 KB.")
            return

        try:
            record = parse_session(json.loads(self.rfile.read(length)))
        except json.JSONDecodeError:
            self.send_error_json(HTTPStatus.BAD_REQUEST, "Body isn't valid JSON.")
            return
        except ValueError as err:
            self.send_error_json(HTTPStatus.BAD_REQUEST, str(err))
            return

        with write_lock:
            append_session(record, self.sessions_path)
        self.send_json(record, HTTPStatus.CREATED)

    def log_message(self, format, *args):
        """Only print API writes, so the terminal isn't flooded with GETs."""
        if self.command == "POST":
            super().log_message(format, *args)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run the Pomodoro web UI.")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true",
                        help="don't open a browser tab automatically")
    args = parser.parse_args(argv)

    # 127.0.0.1 means only this computer can reach the server.
    server = ThreadingHTTPServer(("127.0.0.1", args.port), PomodoroHandler)
    url = f"http://127.0.0.1:{args.port}"
    print(f"Pomodoro running at {url}  (Ctrl+C to stop)")
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

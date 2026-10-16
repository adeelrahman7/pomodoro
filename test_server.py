"""Tests for server.py: input validation plus a real round trip over HTTP."""

import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from server import PomodoroHandler, parse_session, static_file

GOOD = {"label": "CS3360", "start": "2026-10-16T09:00:00", "end": "2026-10-16T09:25:00",
        "minutes": 25, "completed": True}


def test_parse_session_accepts_a_good_record():
    record = parse_session(GOOD)
    assert record["type"] == "work"
    assert record["minutes"] == 25


def test_parse_session_blank_label_becomes_general():
    assert parse_session({**GOOD, "label": "  "})["label"] == "general"


@pytest.mark.parametrize("bad", [
    {**GOOD, "start": "yesterday"},
    {**GOOD, "end": "2026-10-16T08:00:00"},     # ends before it starts
    {**GOOD, "minutes": 0},
    {**GOOD, "minutes": 90},                    # longer than start-to-end
    {**GOOD, "minutes": True},
    {**GOOD, "completed": "yes"},
    {**GOOD, "label": "x" * 41},
    ["not", "an", "object"],
])
def test_parse_session_rejects_bad_input(bad):
    with pytest.raises(ValueError):
        parse_session(bad)


@pytest.fixture
def base_url(tmp_path, monkeypatch):
    """Start the real server on a free port, writing to a temp sessions.json."""
    monkeypatch.setattr(PomodoroHandler, "sessions_path", tmp_path / "sessions.json")
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), PomodoroHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()
    httpd.server_close()


def get_json(url):
    with urlopen(url) as res:
        return json.loads(res.read())


def post_json(url, payload):
    req = Request(url, data=json.dumps(payload).encode(), method="POST",
                  headers={"Content-Type": "application/json"})
    with urlopen(req) as res:
        return res.status, json.loads(res.read())


def test_post_then_read_back(base_url):
    status, saved = post_json(f"{base_url}/api/sessions", GOOD)
    assert status == 201
    assert get_json(f"{base_url}/api/sessions?n=5") == [saved]


def test_summary_endpoint_shape(base_url):
    data = get_json(f"{base_url}/api/summary?week=0")
    assert len(data["per_day"]) == 7
    assert data["per_day"][0]["day"] == "Mon"
    assert data["total_minutes"] == 0


def test_bad_post_returns_400(base_url):
    with pytest.raises(HTTPError) as err:
        post_json(f"{base_url}/api/sessions", {**GOOD, "minutes": -1})
    assert err.value.code == 400


def test_index_is_served(base_url):
    with urlopen(f"{base_url}/") as res:
        assert b"<title>Pomodoro</title>" in res.read()


@pytest.mark.parametrize("path", ["/storage.py", "/../storage.py", "/%2e%2e/storage.py", "/nope.js"])
def test_files_outside_static_are_not_served(base_url, path):
    with pytest.raises(HTTPError) as err:
        urlopen(f"{base_url}{path}")
    assert err.value.code == 404


def test_static_file_rejects_traversal():
    assert static_file("/../storage.py") is None
    assert static_file("/index.html") is not None

"""Load and save Pomodoro session records in a single JSON file.

Writes are atomic: data goes to a temporary file in the same folder, which is
then renamed over sessions.json. A rename is all-or-nothing on every major OS,
so a crash mid-write leaves the old file intact instead of a half-written one.
"""

import json
import os
import tempfile
from pathlib import Path

DEFAULT_PATH = Path(__file__).parent / "sessions.json"


def load_sessions(path=DEFAULT_PATH):
    """Return the list of session records, or [] if the file is missing or empty.

    If the file exists but isn't valid JSON, it is moved aside to
    sessions.json.corrupt (so nothing is lost) and an empty list is returned.
    """
    path = Path(path)
    if not path.exists():
        return []

    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        backup = path.with_suffix(path.suffix + ".corrupt")
        os.replace(path, backup)
        print(f"Warning: {path.name} was unreadable; moved it to {backup.name}.")
        return []

    if not isinstance(data, list):
        raise ValueError(f"{path} should contain a JSON list of sessions.")
    return data


def save_sessions(sessions, path=DEFAULT_PATH):
    """Write all sessions to disk atomically (temp file + rename)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)

    # The temp file must live in the same directory so os.replace is a rename,
    # not a cross-device copy.
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=".sessions-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            json.dump(sessions, tmp, indent=2)
            tmp.flush()
            os.fsync(tmp.fileno())  # make sure bytes hit the disk before renaming
        os.replace(tmp_name, path)
    except BaseException:
        # Clean up the temp file on any failure, including Ctrl+C.
        if os.path.exists(tmp_name):
            os.remove(tmp_name)
        raise


def append_session(record, path=DEFAULT_PATH):
    """Add one session record to the file."""
    sessions = load_sessions(path)
    sessions.append(record)
    save_sessions(sessions, path)

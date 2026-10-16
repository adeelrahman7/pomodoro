"""Countdown loop and work/break cycle logic.

Ctrl+C raises KeyboardInterrupt inside the countdown. A work phase catches it,
logs the partial session if it ran long enough, then re-raises so main.py can
exit cleanly.
"""

import math
import time
from datetime import datetime

from storage import DEFAULT_PATH, append_session

MIN_ABANDONED_SECONDS = 60  # interrupted sessions shorter than this aren't logged


def bell():
    """Ring the terminal bell (the ASCII BEL character)."""
    print("\a", end="", flush=True)


def format_mmss(seconds):
    """Turn a number of seconds into 'mm:ss', rounding up partial seconds."""
    mins, secs = divmod(math.ceil(max(seconds, 0)), 60)
    return f"{mins:02d}:{secs:02d}"


def countdown(seconds, title):
    """Show a live mm:ss countdown on one line, then ring the bell.

    Uses time.monotonic() so the timer isn't thrown off if the system clock
    changes. '\\r' returns the cursor to the start of the line so each update
    overwrites the previous one.
    """
    end = time.monotonic() + seconds
    while True:
        remaining = end - time.monotonic()
        if remaining <= 0:
            break
        print(f"\r{title}  {format_mmss(remaining)} ", end="", flush=True)
        time.sleep(min(0.25, remaining))
    print(f"\r{title}  00:00 ", flush=True)
    bell()


def make_record(label, start, end, completed):
    """Build a session dict from two datetimes."""
    minutes = round((end - start).total_seconds() / 60, 2)
    return {
        "label": label,
        "start": start.isoformat(timespec="seconds"),
        "end": end.isoformat(timespec="seconds"),
        "minutes": minutes,
        "type": "work",
        "completed": completed,
    }


def run_work_phase(label, minutes, cycle, cycles, path=DEFAULT_PATH):
    """Run one work phase and log it. Re-raises KeyboardInterrupt after logging."""
    start = datetime.now()
    try:
        countdown(minutes * 60, f"[{cycle}/{cycles}] Work: {label}")
    except KeyboardInterrupt:
        end = datetime.now()
        elapsed = (end - start).total_seconds()
        print()  # move off the countdown line
        if elapsed >= MIN_ABANDONED_SECONDS:
            append_session(make_record(label, start, end, completed=False), path)
            print(f"Stopped early. Logged {elapsed / 60:.1f} min as abandoned.")
        else:
            print("Stopped early (under 1 minute, not logged).")
        raise

    append_session(make_record(label, start, datetime.now(), completed=True), path)


def run_pomodoro(label, work, brk, cycles, path=DEFAULT_PATH):
    """Run `cycles` work phases with breaks in between (no break after the last)."""
    for cycle in range(1, cycles + 1):
        run_work_phase(label, work, cycle, cycles, path)
        if cycle < cycles:
            countdown(brk * 60, f"[{cycle}/{cycles}] Break")
    print(f"Done! {cycles} work session(s) logged for '{label}'.")

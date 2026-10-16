# Pomodoro Timer

A command-line Pomodoro timer that logs your focus sessions and shows weekly stats.
Python 3.8+, standard library only (pytest for the tests).

## Run it

```bash
cd pomodoro

# 4 cycles of 25 min work / 5 min break
python main.py start --label "CS3360" --work 25 --break 5 --cycles 4

# Quick test run: 6-second phases
python main.py start --label test --work 0.1 --break 0.1 --cycles 2

# This week's stats, or last week's
python main.py summary
python main.py summary --week -1

# Most recent sessions
python main.py log --n 10
```

Press **Ctrl+C** to stop. A work session interrupted after at least 1 minute is
logged with `"completed": false`; shorter ones are discarded.

## Files

| File | What it does |
|------|--------------|
| `main.py` | Parses the `start`, `summary` and `log` commands |
| `timer.py` | Countdown loop, Ctrl+C handling, terminal bell |
| `storage.py` | Reads/writes `sessions.json` atomically (temp file + rename) |
| `summary.py` | Weekly totals, per-day bars, per-label totals, streak |
| `test_summary.py` | pytest tests with fake session data |

`sessions.json` is created on first run next to the scripts. If it's ever
unreadable, it's moved to `sessions.json.corrupt` and a fresh file is started.

## How the stats work

- Weeks run Monday to Sunday; a session belongs to the day it started.
- Total focus time includes abandoned sessions; the completed/abandoned counts are shown separately.
- The streak counts consecutive days with at least one completed session. If you
  haven't finished one yet today, it counts from yesterday so it doesn't reset early.

## Tests

```bash
pip install pytest
python -m pytest
```

## Ideas for next steps

- Desktop notification instead of the bell (`notify-send` on Linux, `osascript` on macOS, or the `plyer` package)
- A `textual` UI with a progress bar
- A long break after every 4th cycle

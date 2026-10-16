"""Command-line entry point.

Usage:
    python main.py start --label "CS3360" --work 25 --break 5 --cycles 4
    python main.py summary [--week -1]
    python main.py log [--n 10]
"""

import argparse
import sys
from datetime import datetime

from storage import load_sessions
from summary import build_summary, format_summary
from timer import run_pomodoro


def positive_float(text):
    """argparse type: a number of minutes greater than zero (fractions allowed)."""
    value = float(text)
    if value <= 0:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return value


def positive_int(text):
    """argparse type: a whole number greater than zero."""
    value = int(text)
    if value <= 0:
        raise argparse.ArgumentTypeError("must be greater than 0")
    return value


def build_parser():
    """Define the three subcommands and their options."""
    parser = argparse.ArgumentParser(description="Pomodoro timer with focus tracking.")
    sub = parser.add_subparsers(dest="command", required=True)

    start = sub.add_parser("start", help="run work/break cycles")
    start.add_argument("--label", default="general", help="what you're working on")
    start.add_argument("--work", type=positive_float, default=25, help="work minutes")
    start.add_argument("--break", dest="brk", type=positive_float, default=5,
                       help="break minutes")
    start.add_argument("--cycles", type=positive_int, default=4, help="number of work sessions")

    summary = sub.add_parser("summary", help="weekly stats")
    summary.add_argument("--week", type=int, default=0,
                         help="0 = this week, -1 = last week, etc.")

    log = sub.add_parser("log", help="list recent sessions")
    log.add_argument("--n", type=positive_int, default=10, help="how many to show")

    return parser


def cmd_log(n):
    """Print the n most recent sessions, newest first."""
    sessions = sorted(load_sessions(), key=lambda s: s["start"], reverse=True)[:n]
    if not sessions:
        print("No sessions logged yet.")
        return
    for s in sessions:
        start = datetime.fromisoformat(s["start"])
        status = "done" if s.get("completed") else "abandoned"
        print(f"{start:%a %m/%d %H:%M}  {s['minutes']:6.1f} min  {status:<9}  {s['label']}")


def main(argv=None):
    args = build_parser().parse_args(argv)

    if args.command == "start":
        try:
            run_pomodoro(args.label, args.work, args.brk, args.cycles)
        except KeyboardInterrupt:
            print("Exiting.")
            sys.exit(130)  # conventional exit code for Ctrl+C
    elif args.command == "summary":
        print(format_summary(build_summary(load_sessions(), args.week)))
    elif args.command == "log":
        cmd_log(args.n)


if __name__ == "__main__":
    main()

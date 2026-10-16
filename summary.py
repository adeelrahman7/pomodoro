"""Weekly statistics over session records.

Every function takes `today` as a parameter (defaulting to the real date) so
tests can pass a fixed date and get predictable results.
"""

from collections import defaultdict
from datetime import date, datetime, timedelta

BAR_WIDTH = 30
DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def session_date(session):
    """The calendar date a session started on."""
    return datetime.fromisoformat(session["start"]).date()


def work_sessions(sessions):
    """Only the sessions of type 'work' (breaks don't count as focus time)."""
    return [s for s in sessions if s.get("type", "work") == "work"]


def week_bounds(offset=0, today=None):
    """Return (monday, sunday) for the week `offset` weeks from this one.

    offset=0 is the current week, -1 is last week, and so on.
    """
    today = today or date.today()
    monday = today - timedelta(days=today.weekday()) + timedelta(weeks=offset)
    return monday, monday + timedelta(days=6)


def sessions_in_range(sessions, start, end):
    """Sessions whose start date falls between start and end, inclusive."""
    return [s for s in sessions if start <= session_date(s) <= end]


def minutes_per_day(sessions, monday):
    """Map each of the 7 dates from `monday` to total minutes that day."""
    totals = {monday + timedelta(days=i): 0.0 for i in range(7)}
    for s in sessions:
        d = session_date(s)
        if d in totals:
            totals[d] += s["minutes"]
    return totals


def minutes_per_label(sessions):
    """Map each label to its total minutes, largest first."""
    totals = defaultdict(float)
    for s in sessions:
        totals[s["label"]] += s["minutes"]
    return dict(sorted(totals.items(), key=lambda item: item[1], reverse=True))


def current_streak(sessions, today=None):
    """Consecutive days, ending today, with at least one completed session.

    If nothing is done yet today, the streak counts back from yesterday,
    so it doesn't reset just because the day isn't over.
    """
    today = today or date.today()
    days = {session_date(s) for s in work_sessions(sessions) if s.get("completed")}

    day = today if today in days else today - timedelta(days=1)
    streak = 0
    while day in days:
        streak += 1
        day -= timedelta(days=1)
    return streak


def build_summary(sessions, week_offset=0, today=None):
    """Collect all weekly stats into one dict (easy to test, easy to print)."""
    today = today or date.today()
    monday, sunday = week_bounds(week_offset, today)
    week = sessions_in_range(work_sessions(sessions), monday, sunday)
    return {
        "monday": monday,
        "sunday": sunday,
        "total_minutes": sum(s["minutes"] for s in week),
        "completed": sum(1 for s in week if s.get("completed")),
        "abandoned": sum(1 for s in week if not s.get("completed")),
        "per_day": minutes_per_day(week, monday),
        "per_label": minutes_per_label(week),
        "streak": current_streak(sessions, today),
    }


def format_minutes(minutes):
    """65.5 -> '1h 06m', 25 -> '25m'."""
    total = round(minutes)
    hours, mins = divmod(total, 60)
    return f"{hours}h {mins:02d}m" if hours else f"{mins}m"


def bar(value, max_value, width=BAR_WIDTH):
    """An ASCII bar scaled so max_value fills `width` characters."""
    if max_value <= 0 or value <= 0:
        return ""
    return "#" * max(1, round(value / max_value * width))


def format_summary(summary):
    """Render a summary dict as printable text."""
    lines = [
        f"Week of {summary['monday']:%b %d} - {summary['sunday']:%b %d, %Y}",
        "",
        f"Total focus:  {format_minutes(summary['total_minutes'])}",
        f"Sessions:     {summary['completed']} completed, {summary['abandoned']} abandoned",
        f"Streak:       {summary['streak']} day(s)",
        "",
        "Minutes per day",
    ]

    peak = max(summary["per_day"].values(), default=0)
    for name, (day, mins) in zip(DAY_NAMES, summary["per_day"].items()):
        lines.append(f"  {name} {day:%m/%d} {mins:6.1f} {bar(mins, peak)}")

    lines += ["", "Minutes per label"]
    if summary["per_label"]:
        width = max(len(label) for label in summary["per_label"])
        top = max(summary["per_label"].values())
        for label, mins in summary["per_label"].items():
            lines.append(f"  {label:<{width}} {mins:6.1f} {bar(mins, top)}")
    else:
        lines.append("  (no sessions this week)")
    return "\n".join(lines)

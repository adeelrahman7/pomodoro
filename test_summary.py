"""Tests for summary.py using fake sessions and a fixed 'today'."""

from datetime import date

from summary import (build_summary, current_streak, format_minutes, minutes_per_label,
                     week_bounds)

# Saturday, Oct 10 2026 -> week runs Mon Oct 5 to Sun Oct 11.
TODAY = date(2026, 10, 10)


def make(day, minutes=25, label="CS3360", completed=True, type_="work"):
    """Fake session starting at 10:00 on the given day of October 2026."""
    return {
        "label": label,
        "start": f"2026-10-{day:02d}T10:00:00",
        "end": f"2026-10-{day:02d}T10:25:00",
        "minutes": minutes,
        "type": type_,
        "completed": completed,
    }


def test_week_bounds_current_and_past():
    assert week_bounds(0, TODAY) == (date(2026, 10, 5), date(2026, 10, 11))
    assert week_bounds(-1, TODAY) == (date(2026, 9, 28), date(2026, 10, 4))


def test_week_bounds_on_a_monday():
    assert week_bounds(0, date(2026, 10, 5))[0] == date(2026, 10, 5)


def test_summary_filters_to_the_week():
    sessions = [make(4), make(5), make(10, minutes=50), make(12)]  # 4th and 12th are outside
    s = build_summary(sessions, 0, TODAY)
    assert s["total_minutes"] == 75
    assert s["per_day"][date(2026, 10, 5)] == 25
    assert s["per_day"][date(2026, 10, 10)] == 50
    assert len(s["per_day"]) == 7


def test_completed_vs_abandoned():
    sessions = [make(6), make(6, completed=False, minutes=10), make(7)]
    s = build_summary(sessions, 0, TODAY)
    assert (s["completed"], s["abandoned"]) == (2, 1)
    assert s["total_minutes"] == 60  # abandoned minutes still count as focus


def test_break_sessions_are_ignored():
    s = build_summary([make(6), make(6, type_="break", minutes=5)], 0, TODAY)
    assert s["total_minutes"] == 25


def test_minutes_per_label_sorted_largest_first():
    sessions = [make(6, label="ANLY 2300"), make(6), make(7)]
    assert list(minutes_per_label(sessions).items()) == [("CS3360", 50), ("ANLY 2300", 25)]


def test_streak_counts_back_from_today():
    sessions = [make(8), make(9), make(10), make(6)]  # gap on the 7th
    assert current_streak(sessions, TODAY) == 3


def test_streak_survives_if_today_not_started():
    assert current_streak([make(8), make(9)], TODAY) == 2


def test_streak_ignores_abandoned_sessions():
    assert current_streak([make(9), make(10, completed=False)], TODAY) == 1


def test_empty_data():
    s = build_summary([], 0, TODAY)
    assert s["total_minutes"] == 0
    assert s["streak"] == 0
    assert s["per_label"] == {}


def test_format_minutes():
    assert format_minutes(25) == "25m"
    assert format_minutes(65.5) == "1h 06m"

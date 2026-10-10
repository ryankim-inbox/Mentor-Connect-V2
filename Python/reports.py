"""Signup totals for UTC calendar periods from one configured database query."""
from datetime import datetime, timedelta, timezone

from db import db


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def signup_summary() -> dict[str, int]:
    now = _utc_now().astimezone(timezone.utc)
    day = now.replace(hour=0, minute=0, second=0, microsecond=0)
    month = day.replace(day=1)
    year = month.replace(month=1)
    next_month = month.replace(year=month.year + (month.month == 12), month=month.month % 12 + 1)
    with db() as conn, conn.cursor() as cursor:
        cursor.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE created_at >= %s AND created_at < %s)::int AS today,
                COUNT(*) FILTER (WHERE created_at >= %s AND created_at < %s)::int AS this_month,
                COUNT(*) FILTER (WHERE created_at >= %s AND created_at < %s)::int AS this_year,
                COUNT(*)::int AS total
            FROM users
            """,
            (day, day + timedelta(days=1), month, next_month, year, year.replace(year=year.year + 1)),
        )
        row = cursor.fetchone()
    return {"today": row["today"], "thisMonth": row["this_month"],
            "thisYear": row["this_year"], "total": row["total"]}


def daily_count():
    return signup_summary()["today"]


def monthly_count():
    return signup_summary()["thisMonth"]


def yearly_count():
    return signup_summary()["thisYear"]

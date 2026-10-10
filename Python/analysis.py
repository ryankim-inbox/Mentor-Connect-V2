"""Request demand and matching activity observed since event tracking began."""
from datetime import datetime, timedelta, timezone

from db import db


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def receive_weekly_matches() -> list[dict]:
    now = _utc_now()
    monday = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=now.weekday())
    first_week = monday - timedelta(weeks=7)
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT occurred_at FROM request_events WHERE kind = 'tracking_started'")
        started = cur.fetchone()["occurred_at"].astimezone(timezone.utc)
        cur.execute("""SELECT (date_trunc('week', occurred_at AT TIME ZONE 'UTC'))::date AS week,
                              count(*) AS matches
                       FROM request_events WHERE kind = 'matched'
                         AND occurred_at >= %s AND occurred_at <= %s
                       GROUP BY week""", (max(first_week, started), now))
        counts = {row["week"].isoformat(): row["matches"] for row in cur.fetchall()}
    weeks = []
    for offset in range(8):
        week = first_week + timedelta(weeks=offset)
        untracked = week + timedelta(weeks=1) <= started
        coverage = "untracked" if untracked else "partial" if started > week else "complete"
        label = week.date().isoformat()
        weeks.append({"week": label, "matches": None if untracked else counts.get(label, 0),
                      "coverage": coverage})
    return weeks


def receive_most_popular_subject() -> list[dict]:
    with db() as conn, conn.cursor() as cur:
        cur.execute("""SELECT t.name AS subject, count(*) AS requests, t.color
                       FROM tags t JOIN request_tags rt ON rt.tag_id = t.id
                       JOIN requests r ON r.id = rt.request_id
                       GROUP BY t.id ORDER BY requests DESC, t.id LIMIT 10""")
        return [dict(row) for row in cur.fetchall()]


def receive_mentor_ranks() -> dict:
    now = _utc_now()
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT occurred_at FROM request_events WHERE kind = 'tracking_started'")
        started = cur.fetchone()["occurred_at"].astimezone(timezone.utc)
        cur.execute("""SELECT u.id, u.name, count(e.id) AS total,
                         avg(extract(epoch FROM (e.occurred_at - e.request_created_at)) / 3600)
                           FILTER (WHERE e.occurred_at >= e.request_created_at) AS hours
                       FROM users u LEFT JOIN request_events e
                         ON e.mentor_id = u.id AND e.kind = 'matched'
                         AND e.occurred_at >= %s AND e.occurred_at <= %s
                       WHERE u.role IN ('mentor', 'both')
                       GROUP BY u.id ORDER BY total DESC, u.id""", (started, now))
        mentors = [{"mentorId": row["id"], "mentorName": row["name"],
                    "totalMatches": row["total"],
                    "avgTimeToMatchHours": float(row["hours"]) if row["hours"] is not None else None}
                   for row in cur.fetchall()]
    return {"trackingStartedAt": started.isoformat(), "mentors": mentors}


def response_time_analysis() -> dict:
    """Compatibility accessor: same activity payload as receive_mentor_ranks()."""
    return receive_mentor_ranks()

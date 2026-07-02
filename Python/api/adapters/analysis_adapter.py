"""
Wraps the student analytics file (Python/analysis.py) without modifying it.

analysis.py is meant to provide:
  - receive_most_popular_subject()  -> most requested subjects
  - receive_mentor_ranks()          -> mentor rankings
  - response_time_analysis()        -> mentor response times

While it cannot be imported (it currently has syntax errors), each endpoint
answers with equivalent numbers computed from the product database and labels
them source="adapter-fallback".
"""

from db import db

from api.adapters.probe import make_envelope, probe_student_call

DEFAULT_COLORS = [
    "#3b82f6",
    "#06b6d4",
    "#dc2626",
    "#f97316",
    "#65a30d",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
]


def get_analysis_status():
    probe = probe_student_call("analysis")
    return make_envelope("analysis.status", probe, fallback_data=None)


def get_weekly_matches():
    # analysis.py has no weekly-matches function yet; probe import status only.
    probe = probe_student_call("analysis")
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            WITH weeks AS (
                SELECT generate_series(
                    date_trunc('week', now()) - interval '7 weeks',
                    date_trunc('week', now()),
                    interval '1 week'
                ) AS wk
            )
            SELECT to_char(w.wk, 'Mon FMDD') AS week, COUNT(r.id)::int AS matches
            FROM weeks w
            LEFT JOIN requests r
                ON r.matched_user_id IS NOT NULL
                AND date_trunc('week', r.created_at) = w.wk
            GROUP BY w.wk
            ORDER BY w.wk
            """
        )
        rows = cur.fetchall()
    data = [{"week": row["week"], "matches": row["matches"]} for row in rows]
    return make_envelope("analytics.weekly_matches", probe, data, normalize=lambda _: None)


def _normalize_subjects(result):
    if not isinstance(result, list) or not result:
        return None
    normalized = []
    for index, item in enumerate(result):
        if not isinstance(item, dict):
            return None
        subject = item.get("subject") or item.get("name")
        count = item.get("requests") or item.get("count") or item.get("total")
        if subject is None or not isinstance(count, (int, float)):
            return None
        normalized.append(
            {
                "subject": str(subject),
                "requests": int(count),
                "color": item.get("color") or DEFAULT_COLORS[index % len(DEFAULT_COLORS)],
            }
        )
    return normalized


def get_popular_subjects():
    probe = probe_student_call("analysis", "receive_most_popular_subject")
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT t.name AS subject, COUNT(rt.request_id)::int AS requests, t.color
            FROM tags t
            JOIN request_tags rt ON rt.tag_id = t.id
            GROUP BY t.id, t.name, t.color
            ORDER BY requests DESC
            LIMIT 6
            """
        )
        rows = cur.fetchall()
    data = [
        {
            "subject": row["subject"],
            "requests": row["requests"],
            "color": row["color"] or DEFAULT_COLORS[index % len(DEFAULT_COLORS)],
        }
        for index, row in enumerate(rows)
    ]
    return make_envelope("analytics.popular_subjects", probe, data, normalize=_normalize_subjects)


def get_popular_time_slots():
    # Availability data lives in users.available_times; the student scheduling
    # module is probed so the dashboard can show its real status alongside.
    probe = probe_student_call("scheduling", "receive_time_data")
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT slot, COUNT(*)::int AS count
            FROM users, unnest(available_times) AS slot
            GROUP BY slot
            ORDER BY count DESC
            LIMIT 8
            """
        )
        rows = cur.fetchall()
    data = [{"slot": row["slot"], "count": row["count"]} for row in rows]
    return make_envelope("analytics.popular_time_slots", probe, data, normalize=lambda _: None)


def _normalize_mentor_ranks(result):
    if not isinstance(result, list) or not result:
        return None
    normalized = []
    for item in result:
        if not isinstance(item, dict):
            return None
        mentor_id = item.get("mentorId") or item.get("mentor_id") or item.get("id")
        name = item.get("mentorName") or item.get("mentor_name") or item.get("name")
        if mentor_id is None or name is None:
            return None
        normalized.append(
            {
                "mentorId": int(mentor_id),
                "mentorName": str(name),
                "responseRate": float(item.get("responseRate") or item.get("response_rate") or 0),
                "totalRequests": int(item.get("totalRequests") or item.get("total_requests") or 0),
                "avgResponseHours": float(
                    item.get("avgResponseHours") or item.get("avg_response_hours") or 0
                ),
            }
        )
    return normalized


def get_mentor_response_rates():
    probe = probe_student_call("analysis", "receive_mentor_ranks")
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                u.id AS mentor_id,
                u.name AS mentor_name,
                COUNT(r.id)::int AS total_requests,
                AVG(EXTRACT(EPOCH FROM (r.updated_at - r.created_at)) / 3600.0) AS avg_response_hours,
                (COUNT(*) FILTER (WHERE r.updated_at - r.created_at <= interval '48 hours'))::numeric
                    / NULLIF(COUNT(r.id), 0) AS response_rate
            FROM users u
            JOIN requests r ON r.matched_user_id = u.id
            WHERE u.role IN ('mentor', 'both')
            GROUP BY u.id, u.name
            ORDER BY response_rate DESC NULLS LAST, total_requests DESC
            LIMIT 10
            """
        )
        rows = cur.fetchall()
    data = [
        {
            "mentorId": row["mentor_id"],
            "mentorName": row["mentor_name"],
            "responseRate": round(float(row["response_rate"] or 0), 2),
            "totalRequests": row["total_requests"],
            "avgResponseHours": round(float(row["avg_response_hours"] or 0), 1),
        }
        for row in rows
    ]
    return make_envelope(
        "analytics.mentor_response_rates", probe, data, normalize=_normalize_mentor_ranks
    )

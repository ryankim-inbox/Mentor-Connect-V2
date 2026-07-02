"""
Wraps the student sign-up reporting file (Python/reports.py) without modifying it.

reports.py is meant to provide daily_count() / monthly_count() / yearly_count()
for new-user sign-ups. While it cannot be imported (it currently has syntax
errors), the summary endpoint answers with the same counts computed from the
product users table, labeled source="adapter-fallback".
"""

from db import db

from api.adapters.probe import make_envelope, probe_student_call


def get_reports_status():
    probe = probe_student_call("reports")
    return make_envelope("python_reports.status", probe, fallback_data=None)


def get_signup_summary():
    probe = probe_student_call("reports", "daily_count")

    student_data = None
    if probe["called"] and isinstance(probe["result"], (int, float)):
        monthly = probe_student_call("reports", "monthly_count")
        yearly = probe_student_call("reports", "yearly_count")
        if (
            monthly["called"]
            and yearly["called"]
            and isinstance(monthly["result"], (int, float))
            and isinstance(yearly["result"], (int, float))
        ):
            student_data = {
                "today": int(probe["result"]),
                "thisMonth": int(monthly["result"]),
                "thisYear": int(yearly["result"]),
                "total": None,
            }

    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT
                COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS today,
                COUNT(*) FILTER (
                    WHERE date_trunc('month', created_at) = date_trunc('month', now())
                )::int AS this_month,
                COUNT(*) FILTER (
                    WHERE date_trunc('year', created_at) = date_trunc('year', now())
                )::int AS this_year,
                COUNT(*)::int AS total
            FROM users
            """
        )
        row = cur.fetchone()
    fallback = {
        "today": row["today"],
        "thisMonth": row["this_month"],
        "thisYear": row["this_year"],
        "total": row["total"],
    }

    envelope = make_envelope(
        "python_reports.summary", probe, fallback, normalize=lambda _: None
    )
    if student_data is not None:
        envelope["source"] = "student-module"
        envelope["data"] = student_data
    return envelope

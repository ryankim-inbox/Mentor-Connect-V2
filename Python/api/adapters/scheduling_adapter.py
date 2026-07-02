"""
Wraps the student scheduling file (Python/scheduling.py) without modifying it.

scheduling.py imports cleanly but its functions currently fail at call time
(receive_time_data connects to a non-existent host, time_dict references an
undefined variable). Each endpoint attempts the student function first, then
answers with overlap data computed from users.available_times, labeled
source="adapter-fallback".
"""

from db import db

from api.adapters.probe import make_envelope, probe_student_call


def get_scheduling_status():
    probe = probe_student_call("scheduling")
    return make_envelope("scheduling.status", probe, fallback_data=None)


def get_overview():
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
        slots = [{"slot": row["slot"], "count": row["count"]} for row in cur.fetchall()]
        cur.execute(
            """
            SELECT COUNT(*)::int AS cnt
            FROM users
            WHERE available_times IS NOT NULL AND array_length(available_times, 1) > 0
            """
        )
        users_with_availability = cur.fetchone()["cnt"]
    data = {"topSlots": slots, "usersWithAvailability": users_with_availability}
    return make_envelope("scheduling.overview", probe, data, normalize=lambda _: None)


def _user_row_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "role": row["role"],
        "available_times": list(row["available_times"] or []),
    }


def suggest_times(user_a: int, user_b: int):
    """
    Attempt scheduling.time_dict(student, teacher) with two real users, then
    compute the availability overlap as the adapter fallback.

    Raises LookupError when either user id does not exist.
    """
    with db() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT id, name, role, available_times FROM users WHERE id = %s", (user_a,)
        )
        row_a = cur.fetchone()
        cur.execute(
            "SELECT id, name, role, available_times FROM users WHERE id = %s", (user_b,)
        )
        row_b = cur.fetchone()

    missing = [uid for uid, row in ((user_a, row_a), (user_b, row_b)) if row is None]
    if missing:
        raise LookupError(f"User id(s) not found: {', '.join(str(m) for m in missing)}")

    student = _user_row_to_dict(row_a)
    teacher = _user_row_to_dict(row_b)

    probe = probe_student_call("scheduling", "time_dict", args=(student, teacher))

    overlap = sorted(set(student["available_times"]) & set(teacher["available_times"]))
    data = {"userA": student, "userB": teacher, "overlap": overlap}

    def normalize(result):
        if isinstance(result, list):
            return {"userA": student, "userB": teacher, "overlap": result}
        return None

    return make_envelope("scheduling.suggest", probe, data, normalize=normalize)

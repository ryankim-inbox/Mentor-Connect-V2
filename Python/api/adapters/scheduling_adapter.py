"""
Wraps the student scheduling file (Python/scheduling.py) without modifying it.

scheduling.py is the ONLY source of scheduling results. When one of its
functions fails (receive_time_data connects to a non-existent host, time_dict
references an undefined variable) or returns an unusable shape, the endpoint
answers success=False with the captured Python error and data=None. There is
no adapter-computed fallback.

The database is touched only to look up the two user records that are passed
as arguments to scheduling.time_dict — inputs, never results.
"""

from db import db

from api.adapters.probe import probe_student_call, student_envelope, student_status_envelope


def get_scheduling_status():
    probe = probe_student_call("scheduling")
    return student_status_envelope("scheduling.status", probe)


def _normalize_overview(result):
    if not isinstance(result, list):
        return None
    slots = []
    for item in result:
        if isinstance(item, dict):
            slot = item.get("slot") or item.get("time")
            count = item.get("count") if "count" in item else item.get("total")
        elif isinstance(item, (list, tuple)) and len(item) == 2:
            slot, count = item
        else:
            return None
        if slot is None or not isinstance(count, (int, float)):
            return None
        slots.append({"slot": str(slot), "count": int(count)})
    return {"topSlots": slots}


def get_overview():
    probe = probe_student_call("scheduling", "receive_time_data")
    return student_envelope("scheduling.overview", probe, normalize=_normalize_overview)


def _user_row_to_dict(row):
    return {
        "id": row["id"],
        "name": row["name"],
        "role": row["role"],
        "available_times": list(row["available_times"] or []),
    }


def suggest_times(user_a: int, user_b: int):
    """
    Look up both users (arguments only) and call scheduling.time_dict(student,
    teacher). The overlap shown to the user is exactly what the student
    function returns; if it fails, the error is reported instead.

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

    def normalize(result):
        if isinstance(result, list) and all(isinstance(entry, str) for entry in result):
            return {"userA": student, "userB": teacher, "overlap": result}
        return None

    return student_envelope(
        "scheduling.suggest",
        probe,
        normalize=normalize,
        invalid_message=(
            "scheduling.time_dict() ran, but did not return a list of overlapping "
            "time strings."
        ),
    )

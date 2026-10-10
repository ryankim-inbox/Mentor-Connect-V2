"""Weekly wall-clock availability counts and intersections."""
from collections import Counter

from db import db
from routers.requests import TIME_SLOT_RE

WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")


def _valid_slots(times):
    return {slot for slot in times or []
            if isinstance(slot, str) and TIME_SLOT_RE.fullmatch(slot)}


def _slot_order(slot):
    return WEEKDAYS.index(slot[:3]), slot[4:]


def receive_time_data() -> list[dict]:
    """Count each user once per valid slot, ordered by weekday and hour."""
    counts = Counter()
    with db() as conn, conn.cursor() as cur:
        cur.execute("SELECT available_times FROM users")
        for row in cur.fetchall():
            counts.update(_valid_slots(row["available_times"]))
    return [{"slot": slot, "count": counts[slot]} for slot in sorted(counts, key=_slot_order)]


def time_dict(student: dict, teacher: dict) -> list[str]:
    """Return unique valid shared labels without assigning dates or timezones."""
    overlap = _valid_slots(student.get("available_times")) & _valid_slots(teacher.get("available_times"))
    return sorted(overlap, key=_slot_order)

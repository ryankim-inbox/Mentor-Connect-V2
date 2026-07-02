"""
Wraps the student analytics file (Python/analysis.py) without modifying it.

analysis.py is meant to provide:
  - receive_most_popular_subject()  -> most requested subjects
  - receive_mentor_ranks()          -> mentor rankings
  - response_time_analysis()        -> mentor response times

The student module is the ONLY source of analytics data. When it cannot be
imported (it currently has a syntax error) or a function fails or returns an
unusable shape, the endpoint answers success=False with the captured Python
error and data=None. There is no adapter-computed fallback.
"""

from api.adapters.probe import probe_student_call, student_envelope, student_status_envelope

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
    return student_status_envelope("analysis.status", probe)


def _normalize_weekly(result):
    if not isinstance(result, list):
        return None
    normalized = []
    for item in result:
        if not isinstance(item, dict):
            return None
        week = item.get("week") or item.get("label")
        matches = item.get("matches") if "matches" in item else item.get("count")
        if week is None or not isinstance(matches, (int, float)):
            return None
        normalized.append({"week": str(week), "matches": int(matches)})
    return normalized


def get_weekly_matches():
    # analysis.py does not define a weekly-matches function yet, so once the
    # import succeeds this reports "missing function" until the student adds
    # receive_weekly_matches() -> [{"week": ..., "matches": ...}].
    probe = probe_student_call("analysis", "receive_weekly_matches")
    return student_envelope("analytics.weekly_matches", probe, normalize=_normalize_weekly)


def _normalize_subjects(result):
    if not isinstance(result, list):
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
    return student_envelope("analytics.popular_subjects", probe, normalize=_normalize_subjects)


def _normalize_time_slots(result):
    if not isinstance(result, list):
        return None
    normalized = []
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
        normalized.append({"slot": str(slot), "count": int(count)})
    return normalized


def get_popular_time_slots():
    # Time-slot demand comes from the student scheduling module's
    # receive_time_data(); its output is the only accepted source.
    probe = probe_student_call("scheduling", "receive_time_data")
    return student_envelope("analytics.popular_time_slots", probe, normalize=_normalize_time_slots)


def _normalize_mentor_ranks(result):
    if not isinstance(result, list):
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
    return student_envelope(
        "analytics.mentor_response_rates", probe, normalize=_normalize_mentor_ranks
    )

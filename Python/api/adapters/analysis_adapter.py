"""Validate student analytics output; the student module owns every aggregate."""
import math

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
        if not isinstance(item, dict) or "matches" not in item:
            return None
        week = item.get("week")
        matches = item.get("matches")
        coverage = item.get("coverage")
        if not isinstance(week, str) or coverage not in ("untracked", "partial", "complete"):
            return None
        if matches is None:
            if coverage != "untracked":
                return None
        elif (coverage == "untracked" or not isinstance(matches, (int, float))
              or not math.isfinite(matches) or matches < 0 or int(matches) != matches):
            return None
        normalized.append({"week": week, "matches": None if matches is None else int(matches),
                           "coverage": coverage})
    return normalized


def get_weekly_matches():
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
        count = item.get("requests", item.get("count", item.get("total")))
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
    if (not isinstance(result, dict) or not isinstance(result.get("trackingStartedAt"), str)
            or not isinstance(result.get("mentors"), list)):
        return None
    mentors = []
    for item in result["mentors"]:
        if not isinstance(item, dict) or item.get("mentorName") is None:
            return None
        mentor_id = int(item["mentorId"]) if "mentorId" in item else None
        if mentor_id is None or "totalMatches" not in item or "avgTimeToMatchHours" not in item:
            return None
        total = int(item["totalMatches"])
        hours = item["avgTimeToMatchHours"]
        if total < 0 or total != item["totalMatches"]:
            return None
        if hours is not None:
            hours = float(hours)
            if not math.isfinite(hours) or hours < 0:
                return None
        mentors.append({"mentorId": mentor_id, "mentorName": str(item["mentorName"]),
                        "totalMatches": total, "avgTimeToMatchHours": hours})
    return {"trackingStartedAt": result["trackingStartedAt"], "mentors": mentors}


def get_mentor_response_rates():
    probe = probe_student_call("analysis", "receive_mentor_ranks")
    return student_envelope(
        "analytics.mentor_response_rates", probe, normalize=_normalize_mentor_ranks
    )

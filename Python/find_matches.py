"""
matching algorithm

Process:
1. Receives a question_id.
2. Loads that question from PostgreSQL.
3. Loads the student who asked the question.
4. Loads all mentors.
5. Skips blocked users.
6. Calculates a matching score.
7. Returns the final result - Result should be in JSON format.

Sample return format (JSON format):

return {
    "success": True,
    "message": "Matches found successfully",
    "question_id": 1,
    "student_id": 10,
    "student_name": "Alex Kim",
    "requested_subject": "Math",
    "requested_topic": "Algebra",
    "matches": [
        {
            "rank": 1,
            "mentor_id": 3,
            "mentor_name": "Sophia Lee",
            "score": 95,
            "reason": "Same subject, same topic, same district, high availability",
            "matched_subjects": ["Math", "Algebra"],
            "district": "San Jose",
            "availability": "Weekday evenings"
        }
    ]
}
"""

from get_users import get_user_by_id, get_all_mentors
from get_questions import get_question_by_id


def none_null_list(value):
    """
    Converts None to an empty list.
    Keeps the student's original helper name for compatibility.
    """
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, set):
        return list(value)
    return [value]


def _normalize_text(value):
    if value is None:
        return ""
    return str(value).strip().lower()


def _normalize_list(value):
    return [_normalize_text(item) for item in none_null_list(value) if _normalize_text(item)]


def _first_present(data: dict, *keys, default=None):
    for key in keys:
        if isinstance(data, dict) and data.get(key) is not None:
            return data.get(key)
    return default


def _overlap(left, right):
    return sorted(set(_normalize_list(left)).intersection(set(_normalize_list(right))))


def calculate_match_score(student: dict, mentor: dict, question: dict):
    """
    Calculate a simple mentor-match score.

    This keeps the original idea:
    - same subject matters a lot
    - same location/district matters
    - language match matters

    A subject or preferred-time overlap contributes once, whether a lesson uses
    one value or a production request supplies several tags and time slots.
    """
    mentor_subjects = _normalize_list(mentor.get("subjects"))
    mentor_location = _normalize_text(_first_present(mentor, "district", "location"))
    mentor_languages = _normalize_list(mentor.get("languages"))
    mentor_available_times = _normalize_list(
        _first_present(mentor, "available_times", "availability", default=[])
    )
    mentor_teaching_style = _normalize_text(mentor.get("teaching_style"))

    student_location = _normalize_text(_first_present(student, "district", "location"))

    q_subjects = _normalize_list(_first_present(question, "subject", "Subject", "subjects"))
    q_location = _normalize_text(_first_present(question, "district", "location", default=student_location))
    q_language = _normalize_text(
        _first_present(question, "preferred_language", "language", "languages")
    )
    q_times = _normalize_list(_first_present(question, "preferred_time", "time", "preferred_times"))
    q_teaching_style = _normalize_text(
        _first_present(question, "preferred_teaching_style", "teaching_style")
    )

    score = 0

    if set(q_subjects).intersection(mentor_subjects):
        score += 50

    if q_location and mentor_location and q_location == mentor_location:
        score += 25
    elif student_location and mentor_location and student_location == mentor_location:
        score += 25

    if q_language and q_language in mentor_languages:
        score += 15

    if set(q_times).intersection(mentor_available_times):
        score += 10

    if q_teaching_style and q_teaching_style == mentor_teaching_style:
        score += 10

    return score


def _build_reason(student: dict, mentor: dict, question: dict):
    reasons = []

    q_subjects = _first_present(question, "subject", "Subject", "subjects")
    if _overlap(q_subjects, mentor.get("subjects")):
        reasons.append("Same subject")

    student_location = _normalize_text(_first_present(student, "district", "location"))
    mentor_location = _normalize_text(_first_present(mentor, "district", "location"))
    q_location = _normalize_text(_first_present(question, "district", "location", default=student_location))
    if mentor_location and mentor_location in (q_location, student_location):
        reasons.append("Same location")

    q_language = _normalize_text(
        _first_present(question, "preferred_language", "language", "languages")
    )
    if q_language and q_language in _normalize_list(mentor.get("languages")):
        reasons.append("Preferred language match")

    q_times = _first_present(question, "preferred_time", "time", "preferred_times")
    if _overlap(q_times, _first_present(mentor, "available_times", "availability", default=[])):
        reasons.append("Preferred time match")

    q_teaching_style = _normalize_text(
        _first_present(question, "preferred_teaching_style", "teaching_style")
    )
    if q_teaching_style and q_teaching_style == _normalize_text(mentor.get("teaching_style")):
        reasons.append("Preferred teaching style match")

    if not reasons:
        reasons.append("General mentor candidate")

    return ", ".join(reasons)


def _safe_error(question_id: int, status: str, message: str, error: Exception | str | None = None):
    return {
        "success": False,
        "feature": "matching",
        "status": status,
        "message": message,
        "error": str(error) if error else None,
        "question_id": question_id,
        "matches": [],
        "is_todo": False,
        "is_real": False,
    }


def _load_block_pairs() -> set[tuple[int, int]]:
    from get_blocks import receive_block_data

    return set(receive_block_data())


def _is_blocked(student_id, mentor_id, block_pairs):
    return (student_id, mentor_id) in block_pairs or (mentor_id, student_id) in block_pairs


def rank_candidates(student: dict, mentors, question: dict, limit: int = 5):
    """Rank prefiltered candidates without I/O or mutation of the input records.

    Callers apply their account/block policy before passing candidates. Shared
    scoring excludes self and zero scores, then breaks ties by numeric user ID.
    """
    matches = []
    student_id = student.get("id")
    for mentor in mentors:
        mentor_id = mentor.get("id")
        if student_id is not None and int(mentor_id) == int(student_id):
            continue
        score = calculate_match_score(student, mentor, question)
        if score <= 0:
            continue
        requested_subjects = none_null_list(_first_present(question, "subject", "Subject", "subjects"))
        mentor_subjects = _normalize_list(mentor.get("subjects"))
        matches.append({
            "mentor_id": mentor_id,
            "mentor_name": mentor.get("name"),
            # The DB reader supplies this marker; matching accepts only a question ID.
            "isDemo": mentor.get("isDemo") is True,
            "score": score,
            "reason": _build_reason(student, mentor, question),
            "matched_subjects": [subject for subject in requested_subjects
                                 if _normalize_text(subject) in mentor_subjects],
            "district": _first_present(mentor, "district", "location"),
            "availability": _first_present(mentor, "available_times", "availability", default=[]),
            "language": mentor.get("languages") or [],
            "teaching_style": mentor.get("teaching_style"),
        })
    matches.sort(key=lambda item: (-item["score"], int(item["mentor_id"])))
    return [{"rank": rank, **match}
            for rank, match in enumerate(matches[:max(0, limit)], start=1)]


def find_matches(question_id: int, limit: int = 5):
    """
    Main entry point used by the website Practice Lab.

    It returns JSON-like dictionaries instead of raising errors, so the frontend
    can display the current student-code status clearly.
    """
    try:
        question = get_question_by_id(question_id)
    except Exception as exc:
        return _safe_error(
            question_id=question_id,
            status="database error",
            message="Could not load the question from the database.",
            error=exc,
        )

    if not question:
        return _safe_error(
            question_id=question_id,
            status="not found",
            message=f"No question found with id {question_id}.",
        )

    student_id = question.get("student_id")

    try:
        student = get_user_by_id(student_id)
    except Exception as exc:
        return _safe_error(
            question_id=question_id,
            status="database error",
            message="Could not load the student from the database.",
            error=exc,
        )

    if not student:
        return _safe_error(
            question_id=question_id,
            status="not found",
            message=f"No student found with id {student_id}.",
        )

    try:
        mentors = get_all_mentors()
    except Exception as exc:
        return _safe_error(
            question_id=question_id,
            status="database error",
            message="Could not load mentors from the database.",
            error=exc,
        )

    try:
        block_pairs = _load_block_pairs()
    except Exception as exc:
        return _safe_error(
            question_id=question_id,
            status="database error",
            message="Could not load blocked relationships from the database.",
            error=exc,
        )
    eligible_mentors = [mentor for mentor in mentors
                        if not _is_blocked(student_id, mentor.get("id"), block_pairs)]
    ranked_matches = rank_candidates(student, eligible_mentors, question, limit)

    return {
        "success": True,
        "feature": "matching",
        "status": "real result",
        "message": "Matches found successfully" if ranked_matches else "No matching mentors found yet.",
        "question_id": question_id,
        "student_id": student_id,
        "student_name": student.get("name"),
        "isDemo": question.get("isDemo") is True,
        "studentIsDemo": student.get("isDemo") is True,
        "requested_subject": question.get("subject"),
        "requested_topic": question.get("topic"),
        "matches": ranked_matches,
        "is_todo": False,
        "is_real": True,
    }

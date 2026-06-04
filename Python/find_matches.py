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

    The only fixes are key-name compatibility and safer None/list handling.
    """
    mentor_subjects = _normalize_list(mentor.get("subjects"))
    mentor_location = _normalize_text(_first_present(mentor, "district", "location"))
    mentor_languages = _normalize_list(mentor.get("languages"))
    mentor_available_times = _normalize_list(
        _first_present(mentor, "available_times", "availability", default=[])
    )
    mentor_teaching_style = _normalize_text(mentor.get("teaching_style"))

    student_location = _normalize_text(_first_present(student, "district", "location"))

    q_subject = _normalize_text(_first_present(question, "subject", "Subject"))
    q_location = _normalize_text(_first_present(question, "district", "location", default=student_location))
    q_language = _normalize_text(
        _first_present(question, "preferred_language", "language", "languages")
    )
    q_time = _normalize_text(_first_present(question, "preferred_time", "time"))
    q_teaching_style = _normalize_text(
        _first_present(question, "preferred_teaching_style", "teaching_style")
    )

    score = 0

    if q_subject and q_subject in mentor_subjects:
        score += 50

    if q_location and mentor_location and q_location == mentor_location:
        score += 25
    elif student_location and mentor_location and student_location == mentor_location:
        score += 25

    if q_language and q_language in mentor_languages:
        score += 15

    if q_time and q_time in mentor_available_times:
        score += 10

    if q_teaching_style and q_teaching_style == mentor_teaching_style:
        score += 10

    return score


def _build_reason(student: dict, mentor: dict, question: dict):
    reasons = []

    q_subject = _normalize_text(_first_present(question, "subject", "Subject"))
    if q_subject and q_subject in _normalize_list(mentor.get("subjects")):
        reasons.append("Same subject")

    student_location = _normalize_text(_first_present(student, "district", "location"))
    mentor_location = _normalize_text(_first_present(mentor, "district", "location"))
    if student_location and mentor_location and student_location == mentor_location:
        reasons.append("Same location")

    q_language = _normalize_text(
        _first_present(question, "preferred_language", "language", "languages")
    )
    if q_language and q_language in _normalize_list(mentor.get("languages")):
        reasons.append("Preferred language match")

    q_time = _normalize_text(_first_present(question, "preferred_time", "time"))
    if q_time and q_time in _normalize_list(_first_present(mentor, "available_times", "availability", default=[])):
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


def _load_block_pairs():
    """
    Load blocked relationships if the block helper is available.
    If the block helper/database is not ready yet, do not crash matching.
    """
    try:
        from get_blocks import receive_block_data

        return set(tuple(row) for row in receive_block_data())
    except Exception:
        return set()


def _is_blocked(student_id, mentor_id, block_pairs):
    return (student_id, mentor_id) in block_pairs or (mentor_id, student_id) in block_pairs


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

    block_pairs = _load_block_pairs()
    matches = []

    for mentor in mentors:
        mentor_id = mentor.get("id")

        if mentor_id == student_id:
            continue

        if _is_blocked(student_id, mentor_id, block_pairs):
            continue

        score = calculate_match_score(student, mentor, question)

        if score <= 0:
            continue

        q_subject = _first_present(question, "subject", "Subject")
        matched_subjects = []
        if _normalize_text(q_subject) in _normalize_list(mentor.get("subjects")):
            matched_subjects.append(q_subject)

        matches.append(
            {
                "mentor_id": mentor_id,
                "mentor_name": mentor.get("name"),
                "score": score,
                "reason": _build_reason(student, mentor, question),
                "matched_subjects": matched_subjects,
                "district": _first_present(mentor, "district", "location"),
                "availability": mentor.get("available_times") or [],
                "language": mentor.get("languages") or [],
                "teaching_style": mentor.get("teaching_style"),
            }
        )

    matches.sort(key=lambda item: item["score"], reverse=True)

    ranked_matches = []
    for rank, match in enumerate(matches[:limit], start=1):
        ranked_matches.append({"rank": rank, **match})

    return {
        "success": True,
        "feature": "matching",
        "status": "real result",
        "message": "Matches found successfully" if ranked_matches else "No matching mentors found yet.",
        "question_id": question_id,
        "student_id": student_id,
        "student_name": student.get("name"),
        "requested_subject": question.get("subject"),
        "requested_topic": question.get("topic"),
        "matches": ranked_matches,
        "is_todo": False,
        "is_real": True,
    }

"""
Location helper functions for the Python Practice Lab.

This file intentionally avoids importing find_matches.py at module import time.
That way, locations.py can still be inspected by the website even if
find_matches.py has a database or runtime issue.
"""


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return value
    if isinstance(value, tuple):
        return list(value)
    if isinstance(value, set):
        return list(value)
    return [value]


def _normalize(value):
    if value is None:
        return ""
    return str(value).strip().lower()


def _locations_from_person(person: dict):
    if not isinstance(person, dict):
        return []

    value = (
        person.get("locations")
        or person.get("location")
        or person.get("district")
        or person.get("city")
    )
    return [_normalize(item) for item in _as_list(value) if _normalize(item)]


def receive_location_data():
    """
    Return distinct user locations from the app database.

    This uses the shared database.py helper instead of a hard-coded host/database
    so it works with the same DATABASE_URL as the rest of the Python practice app.
    """
    from database import get_connection

    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT DISTINCT location
                FROM users
                WHERE location IS NOT NULL
                ORDER BY location;
                """
            )
            rows = cur.fetchall()

    return [row["location"] for row in rows]


def location_data(student: dict, mentor: dict, question: dict | None = None):
    """
    Compare student and mentor location data and return a small score.

    This fixes only the runtime issues in the original idea:
    - quoted dictionary keys
    - local score variable
    - safe list/string handling
    """
    question = question or {}

    mentor_locations = _locations_from_person(mentor)
    student_locations = _locations_from_person(student)

    # If the question carries a preferred location, count it too.
    question_locations = _locations_from_person(question)
    if question_locations:
        student_locations.extend(question_locations)

    score = 0
    overlap = sorted(set(student_locations).intersection(set(mentor_locations)))

    if overlap:
        score += 10

    return {
        "success": True,
        "feature": "locations",
        "status": "real result",
        "score": score,
        "matched_locations": overlap,
        "student_locations": student_locations,
        "mentor_locations": mentor_locations,
        "is_real": True,
        "is_todo": False,
    }


def calculate_location_score(student: dict, mentor: dict, question: dict | None = None):
    """
    Convenience wrapper that returns only the numeric location score.
    """
    return location_data(student, mentor, question).get("score", 0)

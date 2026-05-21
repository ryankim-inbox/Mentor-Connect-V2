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
        },
        {
            "rank": 2,
            "mentor_id": 7,
            "mentor_name": "Daniel Park",
            "score": 87,
            "reason": "Same subject and topic, but different district",
            "matched_subjects": ["Math", "Algebra"],
            "district": "Cupertino",
            "availability": "Weekends"
        },
        {
            "rank": 3,
            "mentor_id": 12,
            "mentor_name": "Mia Chen",
            "score": 78,
            "reason": "Same subject, related topic, available soon",
            "matched_subjects": ["Math"],
            "district": "San Jose",
            "availability": "Friday afternoon"
        }
    ]
}
"""
from get_users import get_user_by_id, get_all_mentors
from get_questions import get_question_by_id

def none_null_list(value):
    """
    Converts None to an empty list.
    """
    if value is None:
        return []
    return value

def calculate_match_score(student: dict, mentor: dict, question: dict):
    mentor_subjects = none_null_list(mentor.get("subjects"))
    mentor_district = none_null_list(mentor.get("district"))
    mentor_languages = none_null_list(mentor.get("languages"))
    q_sub = question.get("Subject")
    q_district = question.get("district")
    q_languages = question.get("languages")
    score = 0
    if q_sub in mentor_subjects:
        score += 50
    if q_district == mentor_district:
        score += 100
    if q_languages in mentor_languages:
        score += 50
    return score




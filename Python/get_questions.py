"""
Gets question/request data from PostgreSQL.
"""

from database import get_connection
from account_policy import with_demo_marker


def get_question_by_id(question_id: int):
    """
    Return one question by id.

    If the question does not exist, return None.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    q.id,
                    q.student_id,
                    q.subject,
                    q.topic,
                    q.preferred_time,
                    q.preferred_language,
                    q.preferred_teaching_style,
                    q.message,
                    q.created_at,
                    u.password_hash
                FROM questions q JOIN users u ON u.id=q.student_id
                WHERE q.id = %s;
                """,
                (question_id,),
            )
            return with_demo_marker(cur.fetchone())


def get_questions_for_student(student_id: int):
    """
    Return all questions created by one student.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    q.id,
                    q.student_id,
                    q.subject,
                    q.topic,
                    q.preferred_time,
                    q.preferred_language,
                    q.preferred_teaching_style,
                    q.message,
                    q.created_at,
                    u.password_hash
                FROM questions q JOIN users u ON u.id=q.student_id
                WHERE q.student_id = %s
                ORDER BY q.created_at DESC;
                """,
                (student_id,),
            )
            return [with_demo_marker(row) for row in cur.fetchall()]

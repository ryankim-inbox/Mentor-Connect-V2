"""
Gets question/request data from PostgreSQL.
"""

from database import get_connection


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
                    id,
                    student_id,
                    subject,
                    topic,
                    preferred_time,
                    preferred_language,
                    preferred_teaching_style,
                    message,
                    created_at
                FROM questions
                WHERE id = %s;
                """,
                (question_id,),
            )
            return cur.fetchone()


def get_questions_for_student(student_id: int):
    """
    Return all questions created by one student.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    student_id,
                    subject,
                    topic,
                    preferred_time,
                    preferred_language,
                    preferred_teaching_style,
                    message,
                    created_at
                FROM questions
                WHERE student_id = %s
                ORDER BY created_at DESC;
                """,
                (student_id,),
            )
            return cur.fetchall()

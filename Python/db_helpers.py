"""
Full walkthrough: docs/PYTHON_DB_HELPERS_GUIDE.md
"""

from database import get_connection




def fetch_all(query, params=None):
    """
    Run a SELECT query and return EVERY matching row.

    Returns a list of dictionaries (one dict per row), because database.py
    opens connections with row_factory=dict_row. No matches = empty list.


    """
    # "with" blocks close the cursor and connection automatically,
    # even if the query fails halfway.
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return cur.fetchall()


def fetch_one(query, params=None):
    """
    Run a SELECT query and return only the FIRST matching row.

    Returns one dictionary, or None if nothing matched.
    Perfect for "look something up by id" queries.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(query, params)
            return cur.fetchone()


def get_all_users():
    """
    Return every user as a list of dictionaries.
    """
    return fetch_all(
        """
        SELECT
            id, name, email, role, location, subjects,
            available_times, languages, grade_level, teaching_style
        FROM users
        ORDER BY id;
        """
    )


def get_user_by_id(user_id: int):
    """
    Return one user as a dictionary, or None if that id does not exist.

    """
    return fetch_one(
        """
        SELECT
            id, name, email, role, location, subjects,
            available_times, languages, grade_level, teaching_style
        FROM users
        WHERE id = %s;
        """,
        (user_id,),  # one-element tuple — the trailing comma matters!
    )


def get_all_mentors():
    """
    Return every user whose role is 'mentor'.

    Note: role can be 'mentee', 'mentor', or 'both'. Like get_users.py,
    this returns only 'mentor' rows — 'both' users are not included.
    """
    return fetch_all(
        """
        SELECT
            id, name, email, role, location, subjects,
            available_times, languages, grade_level, teaching_style
        FROM users
        WHERE role = 'mentor'
        ORDER BY id;
        """
    )

def get_question_by_id(question_id: int):
    """
    Return one question as a dictionary, or None if that id does not exist.

    Useful key: row["student_id"] tells you WHICH user asked the question.
    It matches users.id — that link between tables is a "foreign key".
    """
    return fetch_one(
        """
        SELECT
            id, student_id, subject, topic, preferred_time,
            preferred_language, preferred_teaching_style, message, created_at
        FROM questions
        WHERE id = %s;
        """,
        (question_id,),
    )


def get_questions_for_student(student_id: int):
    """
    Return every question one student has asked, newest first.
    """
    return fetch_all(
        """
        SELECT
            id, student_id, subject, topic, preferred_time,
            preferred_language, preferred_teaching_style, message, created_at
        FROM questions
        WHERE student_id = %s
        ORDER BY created_at DESC;
        """,
        (student_id,),
    )

def get_block_pairs():
    """
    Return every block as a list of dictionaries:

        [{"blocker_id": 1, "blocked_user_id": 502}, ...]

    Each row means: the user with id blocker_id blocked the user with id
    blocked_user_id. Blocks are ONE-WAY — if the other person blocked back,
    that is a separate row.
    """
    return fetch_all(
        """
        SELECT blocker_id, blocked_user_id
        FROM blocks
        ORDER BY id;
        """
    )

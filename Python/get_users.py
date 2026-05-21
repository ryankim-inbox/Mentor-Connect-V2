"""
Gets user/account data from PostgreSQL.
"""

from database import get_connection


def get_all_users():
    """
    Return all users as a list of dictionaries.

    Output example:
    [
        {
            "id": 1,
            "name": "name",
            "role": "role",
            "subjects": ["math", "python"]
        },
        ...
    ]
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    name,
                    email,
                    role,
                    location,
                    subjects,
                    available_times,
                    languages,
                    grade_level,
                    teaching_style
                FROM users
                ORDER BY id;
                """
            )
            return cur.fetchall()


def get_user_by_id(user_id: int):
    """
    Return one user by id.
    If the user does not exist, return None.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    name,
                    email,
                    role,
                    location,
                    subjects,
                    available_times,
                    languages,
                    grade_level,
                    teaching_style
                FROM users
                WHERE id = %s;
                """,
                (user_id,),
            )
            return cur.fetchone()


def get_all_mentors():
    """
    Return all 'mentor'.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    name,
                    email,
                    role,
                    location,
                    subjects,
                    available_times,
                    languages,
                    grade_level,
                    teaching_style
                FROM users
                WHERE role = 'mentor'
                ORDER BY id;
                """
            )
            return cur.fetchall()

def get_all_mentees():
    """
    Return all 'mentee'.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    name,
                    email,
                    role,
                    location,
                    subjects,
                    available_times,
                    languages,
                    grade_level,
                    teaching_style
                FROM users
                WHERE role = 'mentee'
                ORDER BY id;
                """
            )
            return cur.fetchall()

def get_all_both():
    """
    Return all 'mentee'.
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    id,
                    name,
                    email,
                    role,
                    location,
                    subjects,
                    available_times,
                    languages,
                    grade_level,
                    teaching_style
                FROM users
                WHERE role = 'both'
                ORDER BY id;
                """
            )
            return cur.fetchall()
"""
db_helpers.py

Small, reusable helpers for READING data out of PostgreSQL.

How the pieces fit together:

    db_helpers.py   (this file — easy functions you can call)
        |
        v
    database.py     (get_connection() — the one "door" to the database)
        |
        v
    PostgreSQL      (ONE database; the tables users, questions, blocks,
                     requests, ... all live INSIDE it)

The idea that clears up most past confusion:
- host     = the address of the COMPUTER PostgreSQL runs on ("localhost").
- database = the NAME of one database on that computer ("mentor_connect_mock").
- users, questions, blocks are TABLES inside that one database.
  You pick the table in the SQL ("FROM blocks"), never in connect().
- get_blocks is just a Python FILE in this folder. File names never
  appear in a database connection.

So: never call psycopg2.connect(...) yourself. database.py already reads
DATABASE_URL from the .env file and opens the connection correctly.

get_users.py and get_questions.py run the same queries "the long way",
writing out the with-blocks every time. This file shows the short way:
write the boilerplate ONCE (fetch_all / fetch_one), and every new query
becomes a tiny function.

Full walkthrough: docs/PYTHON_DB_HELPERS_GUIDE.md
"""

from database import get_connection


# ---------------------------------------------------------------------------
# The two core helpers. Everything else in this file is built on them.
# ---------------------------------------------------------------------------


def fetch_all(query, params=None):
    """
    Run a SELECT query and return EVERY matching row.

    Returns a list of dictionaries (one dict per row), because database.py
    opens connections with row_factory=dict_row. No matches = empty list.

    Example:
        rows = fetch_all("SELECT id, name FROM users WHERE role = %s;", ("mentor",))
        print(rows[0]["name"])
    """
    # "with" blocks close the cursor and connection automatically,
    # even if the query fails halfway.
    with get_connection() as conn:
        with conn.cursor() as cur:
            # params safely fills in the %s placeholders.
            # NEVER build SQL with f-strings — that allows SQL injection.
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


# ---------------------------------------------------------------------------
# Users. Same results as the long versions in get_users.py.
# ---------------------------------------------------------------------------


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

    user_id is the number in the users table's "id" column (e.g. 1, 501).
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


# ---------------------------------------------------------------------------
# Questions. Same results as the long versions in get_questions.py.
# ---------------------------------------------------------------------------


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

    student_id is that student's users.id — the same number you would
    pass to get_user_by_id().
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


# ---------------------------------------------------------------------------
# Blocks. The working version of what get_blocks.py tries to do.
# ---------------------------------------------------------------------------


def get_block_pairs():
    """
    Return every block as a list of dictionaries:

        [{"blocker_id": 1, "blocked_user_id": 502}, ...]

    Each row means: the user with id blocker_id blocked the user with id
    blocked_user_id. Blocks are ONE-WAY — if the other person blocked back,
    that is a separate row.

    Remember: "blocks" is a TABLE inside our one database — there is no
    separate "blocks_db", and "get_blocks" is a file name, not a host.
    """
    return fetch_all(
        """
        SELECT blocker_id, blocked_user_id
        FROM blocks
        ORDER BY id;
        """
    )

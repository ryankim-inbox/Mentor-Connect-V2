"""
database.py

This file has only one job:
Connect Python to PostgreSQL.

Think of this file as the "door" to the database.
Other files will use get_connection() whenever they need to read or write DB data.

Important integration note:
This module should be importable even when DATABASE_URL is not configured yet.
The actual database connection is opened only when get_connection() is called.
That way, the website /practice-lab can import student practice files and show a
clear runtime/database status instead of failing during import.
"""

import os
from pathlib import Path

from dotenv import load_dotenv


# Load both the current working directory .env and Python/.env.
# This makes the file work from IntelliJ, terminal, and uvicorn launched inside
# the Python folder.
load_dotenv()
load_dotenv(dotenv_path=Path(__file__).with_name(".env"), override=False)


def get_database_url():
    """
    Return the configured PostgreSQL URL, or None if it is missing.
    """
    return os.getenv("DATABASE_URL")


def get_connection():
    """
    Open a PostgreSQL connection.

    This function intentionally raises a clear error only when a database action
    is attempted. Do not call this at module import time.
    """
    database_url = get_database_url()

    if not database_url:
        raise ValueError(
            "DATABASE_URL is missing. Create a .env file and add DATABASE_URL."
        )

    import psycopg
    from psycopg.rows import dict_row

    return psycopg.connect(database_url, row_factory=dict_row)


def get_database_status():
    """
    Small helper for dashboards/tests. It does not open a DB connection.
    """
    return {
        "configured": bool(get_database_url()),
        "message": "DATABASE_URL is configured" if get_database_url() else "DATABASE_URL is missing",
    }

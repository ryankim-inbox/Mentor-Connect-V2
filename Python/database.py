"""
database.py

This file has only one job:
Connect Python to PostgreSQL.

Think of this file as the "door" to the database.
Other files will use get_connection() whenever they need to read or write DB data.
"""

import os

import psycopg
from psycopg.rows import dict_row
from dotenv import load_dotenv


load_dotenv()
DATABASE_URL = os.getenv("DATABASE_URL")

def get_connection():
    """
    Open a PostgreSQL connection
    """
    if not DATABASE_URL:
        raise ValueError(
            "DATABASE_URL is missing. Create a .env file and add DATABASE_URL."
        )

    return psycopg.connect(DATABASE_URL, row_factory=dict_row)

get_connection()

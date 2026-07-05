# Talking to PostgreSQL from Python — Student Guide

Several practice files contain a line like this:

```python
connections = psycopg2.connect(database="requests_db", host="get_blocks")
```

This can never work, and once you see *why*, connecting to the database stops
being scary. This guide explains the why, and introduces
**`Python/db_helpers.py`** — small functions you can call instead of writing
connection code ever again.

---

## 1. The one-line fix

Delete every `psycopg2.connect(...)` from your practice files and use the
connection this project already set up for you:

```python
from database import get_connection    # the one "door" to the database
```

or, even easier, use the ready-made helpers:

```python
from db_helpers import get_all_users, get_user_by_id, get_block_pairs, fetch_all
```

> Rule of thumb: **practice files never import psycopg2 and never call
> connect() themselves.** `Python/database.py` does it once, correctly,
> for everyone. (This project actually uses psycopg version 3, not psycopg2.)

## 2. Where the connection really comes from: `DATABASE_URL`

`database.py` reads one line from the file `Python/.env`:

```
postgresql://you@localhost:5432/mentor_connect_mock
│            │   │         │    │
│            │   │         │    └── database NAME — one database; ALL our
│            │   │         │       tables live inside it
│            │   │         └────── port (5432 is Postgres's default)
│            │   └──────────────── host = WHICH COMPUTER Postgres runs on
│            │                     ("localhost" = this very machine)
│            └──────────────────── the Postgres user (your computer username)
└───────────────────────────────── the protocol, like https:// for websites
```

Everything `connect()` needs is in that URL. If `.env` is missing,
`get_connection()` raises a clear error telling you to create it.

## 3. Why `host="get_blocks"` can never work

| You wrote                | What Postgres hears                             | What you actually wanted            |
| ------------------------ | ----------------------------------------------- | ----------------------------------- |
| `host="get_blocks"`      | "find a **computer** on the network named get_blocks" | `host="localhost"` (via DATABASE_URL) |
| `database="blocks_db"`   | "open a **database** named blocks_db" (doesn't exist) | the one real database, `mentor_connect_mock` |
| *(nothing)*              | —                                               | `FROM blocks` **inside your SQL**   |

Three separate mix-ups, one root cause:

* **`host` is a computer address**, like a street address. There is no
  computer called `get_blocks` — that's a *Python file* in this folder, and
  file names never appear in a database connection.
* **`database` is the name of one database.** There is no `blocks_db`,
  `requests_db`, or `users_db`. There is exactly **one** database
  (`mentor_connect_mock`) that contains **many tables**: `users`,
  `questions`, `blocks`, `requests`, ...
* **You choose the table in the SQL, not in connect():**
  `SELECT ... FROM blocks;`

## 4. Database vs table vs column vs row

```
PostgreSQL running on localhost
└── mentor_connect_mock              ← the DATABASE (named in DATABASE_URL)
    ├── users                        ← a TABLE
    │      id | name     | email                | role   ...   ← COLUMNS
    │       1 | Alex Kim | student001@test.edu  | mentee       ← a ROW
    │     501 | ...      | mentor501@test.edu   | mentor       ← another ROW
    ├── questions                    ← another TABLE
    │      (its student_id column points at users.id)
    └── blocks                       ← another TABLE
           (blocker_id and blocked_user_id both point at users.id)
```

If it helps: the database is one Excel file, tables are the sheets inside it,
columns are the headers, and rows are the lines of data. You connect to the
*file* once, then say which *sheet* you want in each query.

## 5. How to get a user's id

You never invent an id — Postgres assigned one to every row automatically
(that's what `SERIAL PRIMARY KEY` means). You *look ids up*:

```python
from db_helpers import get_user_by_id, fetch_one

get_user_by_id(1)["name"]        # rows are dictionaries -> 'Alex Kim'

# Don't know the id? Search by something you do know:
row = fetch_one("SELECT id, name FROM users WHERE email = %s;",
                ("student001@test.edu",))
row["id"]                        # -> 1
```

Handy ids in the seeded practice database: `1` is a student (Alex Kim,
`student001@test.edu`) and `501` is a mentor (`mentor501@test.edu`).

## 6. How to get a question's `student_id`

Every row in `questions` carries a `student_id` column — the `users.id` of
whoever asked it. A column that points at another table's id is called a
**foreign key**:

```
questions.student_id  ───────────▶  users.id
```

```python
from db_helpers import get_question_by_id, get_user_by_id, get_questions_for_student

q = get_question_by_id(1)
q["student_id"]                       # -> 1  (the asker's users.id)
get_user_by_id(q["student_id"])       # -> the full user row for the asker

get_questions_for_student(1)          # the reverse: all questions user 1 asked
```

## 7. Filling in values safely: `%s` placeholders

Never build SQL with f-strings:

```python
# DANGEROUS — never do this
cur.execute(f"SELECT * FROM users WHERE id = {user_id}")
```

If `user_id` ever comes from a person, they can type SQL into it and run it
(this is "SQL injection" — the classic input is `1; DROP TABLE users;`).
Instead, put `%s` where each value goes and pass the values separately:

```python
fetch_one("SELECT * FROM users WHERE id = %s;", (user_id,))
fetch_all("SELECT * FROM users WHERE role = %s AND location = %s;",
          ("mentor", "Cupertino"))     # values in the same order as the %s
```

The database driver sends the query and the values separately, so a value can
never be mistaken for SQL. Two gotchas:

* `%s` here is **not** Python's `%` string formatting — don't use `%` or
  `.format()` or f-strings on the query yourself.
* One value still needs a **tuple**: `(user_id,)` — the trailing comma is
  what makes it a tuple.

## 8. Cheat sheet: what's in `db_helpers.py`

| Function                            | Returns                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `fetch_all(query, params=None)`     | every matching row — list of dicts (maybe empty)     |
| `fetch_one(query, params=None)`     | first matching row — one dict, or `None`             |
| `get_all_users()`                   | all users, ordered by id                             |
| `get_user_by_id(user_id)`           | one user dict, or `None`                             |
| `get_all_mentors()`                 | users with `role = 'mentor'` (note: `'both'` exists too) |
| `get_question_by_id(question_id)`   | one question dict, or `None`                         |
| `get_questions_for_student(student_id)` | that student's questions, newest first          |
| `get_block_pairs()`                 | `[{"blocker_id": ..., "blocked_user_id": ...}, ...]` |

`get_users.py` and `get_questions.py` run the same queries with the
with-blocks written out long-hand. Read one of them side by side with
`db_helpers.py` — the results are identical; `fetch_all`/`fetch_one` just
capture the repeated part once.

## 9. Try it (2 minutes)

From the `Python/` folder, start the interpreter you normally run the project
with (the project venv) and:

```python
>>> from db_helpers import get_all_users, get_user_by_id, get_block_pairs
>>> len(get_all_users())
1000
>>> get_user_by_id(1)["name"]
'Alex Kim'
>>> get_block_pairs()[0]
{'blocker_id': 1, 'blocked_user_id': 502}
>>> get_user_by_id(999999) is None     # missing id -> None, not a crash
True
```

When you go back to fix `analysis.py`, `reports.py`, `scheduling.py`,
`get_blocks.py`, `spamlblock.py`, or `mentor_ranks.py`, step 1 is always the
same: delete the `psycopg2.connect(...)` block and replace it with a call to
one of these helpers (or `fetch_all` with your own SQL). The logic of those
assignments — matching, ranking, warnings — is still yours to write.

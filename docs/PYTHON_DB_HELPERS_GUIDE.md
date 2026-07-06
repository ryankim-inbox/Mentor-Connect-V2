
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




Everything `connect()` needs is in that URL. If `.env` is missing,
`get_connection()` raises a clear error telling you to create it.

## 2. How to get a user's id


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

## 3. How to get a question's `student_id`

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

## 4. Cheat sheet: what's in `db_helpers.py`

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





When you go back to fix `analysis.py`, `reports.py`, `scheduling.py`,
`get_blocks.py`, `spamlblock.py`, or `mentor_ranks.py`, step 1 is always the
same: delete the `psycopg2.connect(...)` block and replace it with a call to
one of these helpers (or `fetch_all` with your own SQL). The logic of those
assignments — matching, ranking, warnings — is still yours to write.

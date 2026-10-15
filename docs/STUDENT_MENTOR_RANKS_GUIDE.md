# Mentor popularity badges: six Python missions

Your Python code computes mentor popularity ranks and badge labels for the lesson
API. Complete the missions in `Python/mentor_ranks.py` in order. The file
stays importable while unfinished, and its authenticated routes return a safe
TODO response until Missions 5 and 6 are implemented.

`Python/mentor_ranks_answer.py` is the tested reference. Try the mission and
run its focused check before comparing your work with the answer. The app does
not import the answer automatically: the dedicated loopback lesson server loads
the student file by default. Production `Python/main.py` does not mount these
routes, and the public gateway returns 404 for mentor-rank paths, whether or not
the caller is signed in.

## What the score means

Popularity is the number of requests currently in `matched` status that are
credited to a mentor. It is a count of matches, not proof that lessons were
confirmed or completed. This exercise does not count `open` or `closed`
requests.

Only users with role `mentor` or `both` appear. A mentor with no qualifying
requests still appears with `matchedCount: 0`, `rank: null`, and `badge: null`.

| Request `role` | Mentor who receives the point |
|---|---|
| `mentor` | `author_id` |
| `mentee` | `matched_user_id` |

A qualifying request must also have `status = 'matched'` and a non-null
`matched_user_id`. There is no stored mentor count: compute it from the
existing `users` and `requests` tables.

## Data as it moves through the missions

The database stage uses snake_case rows:

```json
{"id": 501, "name": "Sophia Lee", "matched_count": 3}
```

The public API uses exactly five camelCase fields:

```json
{"mentorId": 501, "mentorName": "Sophia Lee", "matchedCount": 3, "rank": 1, "badge": "Master"}
```

The flow is:

```text
database rows → sorted copies → ranked copies → badge lookup → public rows
 Mission 1       Mission 2       Mission 3       Mission 4     Missions 5–6
```

## Provided helper map

Keep these helpers above the mission code. Their full docstrings in the
student file include parameters, return values, usage examples, mission steps,
and failure behavior.

| Helper | Job | Used by |
|---|---|---|
| `_require_user(request)` | Return the session user ID or raise HTTP 401 | Mission 5 step 1; Mission 6 step 1 |
| `_fetch_rows(query, params)` | Run one parameterized read query and return dictionary rows | Mission 1 step 3 |
| `_public_row(row)` | Expose only the five public fields and call your badge function | Mission 5 step 4; Mission 6 step 4 |
| `_todo(mission, message)` | Keep an unfinished route safe for HTTP and the UI | Mission 5 step 2; Mission 6 step 3 |

These helpers handle routine plumbing. The SQL attribution, sorting, ranking,
badge selection, and endpoint composition remain your work.

## Mission checklist

### Mission 1: aggregate matched requests

- Select every `mentor` and `both` user.
- Use a `LEFT JOIN` so zero-match mentors remain.
- Put the matched/null/role attribution rules in the join condition.
- Use `COUNT(r.id)`, group by user, and bind all values as query parameters.

Putting the request filter in `WHERE` can remove zero rows. `COUNT(*)` can
incorrectly count the empty side of a left join as one.

Run the real PostgreSQL check in a disposable database. It creates connection-local
temporary tables and always rolls back; it does not touch the developer database.

```sh
MENTOR_RANKS_MODULE=mentor_ranks PYTHON_BIN=.venv/bin/python \
  sh scripts/test-python.sh tests/test_mentor_ranks.py -k test_mission_1
```

### Mission 2: sort without mutation

- Copy each input dictionary.
- Sort `matched_count` from high to low.
- Break equal-count ties by `id` from low to high.

Input `[(3, 3), (2, 5), (1, 3)]` must become
`[(2, 5), (1, 3), (3, 3)]`. This test uses raw literal rows, so Mission 3 may
remain unfinished while Mission 2 turns green.

```sh
MENTOR_RANKS_MODULE=mentor_ranks .venv/bin/python -m pytest -q \
  tests/test_mentor_ranks.py -k test_mission_2
```

### Mission 3: assign competition ranks

- Walk the already sorted input with positions starting at 1.
- Reuse the prior rank when a positive count ties.
- Give zero counts rank `None` and leave input dictionaries unchanged.

Counts `[5, 3, 3, 1, 0]` produce ranks `[1, 2, 2, 4, None]`. This is
competition ranking: the position after a tie is skipped.

```sh
MENTOR_RANKS_MODULE=mentor_ranks .venv/bin/python -m pytest -q \
  tests/test_mentor_ranks.py -k test_mission_3
```

### Mission 4: choose the badge

Scan the provided threshold table from smallest to largest and return the
first badge whose inclusive upper bound contains the rank.

| Rank | Badge |
|---|---|
| 1 | Master |
| 2–10 | Platinum |
| 11–100 | Diamond |
| 101–500 | Gold |
| 501–1000 | Silver |
| 1001–2000 | Steel |
| 2001–5000 | Bronze |
| 5001–10000 | Mud |
| `None`, nonpositive, or above 10000 | `None` |

Equal ranks always receive equal badges, even if a large tied group extends
past a boundary position.

```sh
MENTOR_RANKS_MODULE=mentor_ranks .venv/bin/python -m pytest -q \
  tests/test_mentor_ranks.py -k test_mission_4
```

### Mission 5: return the complete list

- Authenticate before calling the database.
- Compose Missions 1, 2, and 3 in order.
- Format every row with `_public_row`.
- Return `[]` for an empty dataset.

The route is `GET /api/mentor-ranks`. While unfinished, it returns the Mission
5 TODO envelope. Once complete, it returns a list including zero-match mentors.

```sh
MENTOR_RANKS_MODULE=mentor_ranks .venv/bin/python -m pytest -q \
  tests/test_mentor_ranks.py -k test_mission_5
```

### Mission 6: return one global rank

- Authenticate before validation or database work.
- Keep the provided HTTP 422 response for a nonpositive ID.
- Build the full global ranking before selecting the requested mentor.
- Format the matching row; raise HTTP 404 when no eligible mentor matches.

Do not filter the database to one mentor before ranking. That would make every
requested mentor appear to be rank 1. Missing IDs and mentee-only IDs return
404; zero-match mentors are valid results with null rank and badge.

```sh
MENTOR_RANKS_MODULE=mentor_ranks .venv/bin/python -m pytest -q \
  tests/test_mentor_ranks.py -k test_mission_6
```

## Run the checks

The default suite verifies the answer key and stable student interfaces,
anonymous-access safety, row formatting, and the shared TODO helper. It also
starts the actual student lesson server with a disposable canonical-schema
database and checks authenticated list/detail agreement for matched, both-role,
and zero-match mentors, plus HTTP 401/422/404 behavior. Use the disposable
database runner for the full checks:

```sh
PYTHON_BIN=.venv/bin/python sh scripts/test-python.sh tests/test_mentor_ranks.py
```

To verify completion of all six student missions, explicitly select the student
module and run the entire rank suite:

```sh
MENTOR_RANKS_MODULE=mentor_ranks PYTHON_BIN=.venv/bin/python \
  sh scripts/test-python.sh tests/test_mentor_ranks.py -q
```

For a focused real HTTP completion check:

```sh
PYTHON_BIN=.venv/bin/python sh scripts/test-python.sh tests/test_mentor_ranks.py \
  -q -k test_lesson_http_list_and_detail_share_global_ranks
```

Student mission unit checks select `mentor_ranks` through
`MENTOR_RANKS_MODULE=mentor_ranks`; the default suite uses the independent
reference for those checks. Both selections verify the actual student lesson
server. Completed list/detail routes return the five public fields without a
TODO response; zero-match mentors retain null rank and badge. The TODO helper is
tested independently of completed routes.

## Run the lesson server

From the repository root, start the student version on loopback:

```sh
.venv/bin/python Python/mentor_ranks_server.py --port 8001
```

Open `http://127.0.0.1:8001/docs` for the interactive endpoint list. The
lesson server uses the real authentication and database helpers without
importing the separate chat exercise.

To run the reference explicitly, stop the student server and use:

```sh
.venv/bin/python Python/mentor_ranks_server.py --answer --port 8001
```

Only one process can use the port at a time. This command does not enable
automatic reload. After editing `Python/mentor_ranks.py`, press Ctrl-C in the
server terminal and run the student command again.

Call the loopback lesson endpoints directly using the interactive docs or curl
below. The existing Profile and Recommendations pages do not render
`MentorRankBadge`. That unmounted lesson component supports raw rank arrays and
hides TODO data and null badges, but it is not a production integration.

## Log in and call the API with curl

The generated local demo database documents the password `Password123!` for
its demo users. Log in and save the session cookie:

```sh
curl -i -c /tmp/mentor-ranks.cookies \
  -H 'Content-Type: application/json' \
  -d '{"email":"mentor501@test.edu","password":"Password123!"}' \
  http://127.0.0.1:8001/api/auth/login
```

Use the cookie for the list and one-mentor endpoints:

```sh
curl -s -b /tmp/mentor-ranks.cookies \
  http://127.0.0.1:8001/api/mentor-ranks
```

```sh
curl -s -b /tmp/mentor-ranks.cookies \
  http://127.0.0.1:8001/api/mentor-ranks/501
```

An anonymous request should return 401. An authenticated unfinished list or
single route should return its TODO dictionary with HTTP 200. Restart after
editing, then repeat the same command.

## Troubleshooting

- `401 Not authenticated`: log in again and pass the saved cookie with `-b`.
- `TODO`: complete the named mission, restart the server, and retry.
- Mission 1 is skipped: use the disposable database runner above; a skipped
  test does not prove the SQL is correct.
- Missing badge: inspect `matchedCount`, `rank`, and `badge`; null values are
  correct for zero matches, and the unmounted lesson badge component hides them.
- Unexpected answer output: stop the server and restart without `--answer`.
- Port already in use: stop your earlier lesson server or choose another port.
- The normal app encounters a chat import error: that is a separate student
  exercise. Use `mentor_ranks_server.py` for these missions.

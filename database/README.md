# Local mock/test database — `mentor_connect_mock`

`mentor_connect_mock_1000.sql` is a self-contained, deterministic PostgreSQL seed
for local development, website testing, and the student Python practice files in
`Python/`. It creates **every table the app and the student code expect** and
fills them with 1000 well-formed fake users plus related records.

> **WARNING** — the seed DROPs and recreates its tables. Only ever run it
> against a local test database (e.g. `mentor_connect_mock`). Never point it at
> production or at a database whose data you care about.

## 1. Install

```bash
dropdb --if-exists mentor_connect_mock
createdb mentor_connect_mock
psql mentor_connect_mock -f database/mentor_connect_mock_1000.sql
```

URL form (equivalent):

```bash
psql "postgresql://$(whoami)@localhost:5432/mentor_connect_mock" -f database/mentor_connect_mock_1000.sql
```

The file is repeatable: running it again fully resets the mock data.

## 2. Point the Python backend at it

Edit `Python/.env` **manually** (this file is git-ignored — do not commit it):

```env
DATABASE_URL=postgresql://YOUR_MAC_USERNAME@localhost:5432/mentor_connect_mock
SESSION_SECRET=dev-secret-change-me
PORT=8000
```

Example for this machine:

```env
DATABASE_URL=postgresql://rinny@localhost:5432/mentor_connect_mock
SESSION_SECRET=dev-secret-change-me
PORT=8000
```

## 3. Run the app

Backend:

```bash
cd Python
source ../.venv/bin/activate
python main.py
curl http://localhost:8000/api/healthz   # {"status":"ok","backend":"python-fastapi"}
```

Frontend:

```bash
PORT=8080 BASE_PATH=/ pnpm --filter @workspace/peerbridge dev
# open http://localhost:8080
```

## 4. Demo logins (password for every user: `Password123!`)

| Email | User ID | Role |
|---|---|---|
| `student001@test.edu` | 1 | mentee |
| `mentor501@test.edu` | 501 | mentor |
| `both951@test.edu` | 951 | both |

All 1000 users share the same bcrypt hash of `Password123!`, so any seeded
email can log in.

## 5. Fixed sample scenario (for tutoring demos)

- **Question 1 / Request 1** belong to **user 1** (Alex Kim): subject `Math`,
  topic `Algebra`, preferred times `Mon 17:00` + `Wed 19:00`, language
  `English`, style `step_by_step`.
- **Mentor 501** (Sophia Lee) matches question 1 on every axis
  (subject + location `Cupertino` + language + `Mon 17:00` + style) → rank 1,
  score 110 on the Recommendations page.
- **Mentor 502** (Marcus Chen) is an equally strong match, but **user 1 blocks
  user 502** (blocks row #1). Once the student fixes `Python/get_blocks.py` to
  read the real `blocks` table, mentor 502 disappears from the matches —
  a built-in demonstration of block filtering.
- **Users 1 and 501 share the `Mon 17:00` slot** for the Scheduling page
  (`/api/scheduling/suggest?user_a=1&user_b=501`).
- Reported users **613 & 614 have ≥5 reports** (banned tier), **402 & 403 have
  ≥3** (serious-warning tier) for the Admin Reports page.

## 6. What the seed creates

| Table | Rows | Notes |
|---|---|---|
| `districts` | 32 | Bay Area school districts (`type='high_school'`) |
| `tags` | 22 | subjects; tag names == the subject vocabulary used everywhere |
| `users` | 1000 | ids 1–500 mentee, 501–950 mentor, 951–1000 both; every row filled (bio, subjects, location, available_times, languages, grade_level, teaching_style) |
| `requests` | 750 | product help/offer posts; ~72% open, 20% matched, 8% closed; includes the `request` compatibility column (primary subject) and a non-empty `preferred_times` array on every row |
| `request_tags` | 1455 | ≥1 tag per request (subject tag + extras) |
| `questions` | 720 | practice table for `get_questions.py` / `find_matches.py`; question id N == student id N for N ≤ 500; `preferred_time` (single) + `preferred_times` (full list) |
| `reports` | 108 | engineered threshold tiers (1 / 2 / 3 / 4 / 5 / 6 reports) |
| `blocks` | 120 | unique pairs; includes demo block 1→502 |
| `schedules` | 3023 | one row per user per weekly slot, derived 1:1 from `users.available_times` |
| views | 6 | 4 analytics helpers (`v_popular_subjects`, `v_mentor_ranks`, `v_popular_time_slots`, `v_response_times`) + 2 compatibility views (`mentors`, `schedules_db`) |

Schema notes:

- `users` carries the product columns **plus** the additive practice columns
  from `Python/migrations/001_practice_additive.sql` (`location`,
  `available_times`, `languages`, `grade_level`, `teaching_style`), so both the
  web app (`Python/routers/*`) and the student files (`Python/get_users.py`,
  `find_matches.py`, scheduling adapter) run against one database.
- `questions` matches `Python/create_tables.sql` but references the product
  `users` table and adds the `preferred_times TEXT[]` column described below.
- All foreign keys, checks (`role`, `status`), unique constraints, and indexes
  (including GIN indexes on `requests.preferred_times` /
  `questions.preferred_times` for `&&` overlap queries) are created by the
  seed; sequences are reset after the explicit-id inserts.

### Weekly time slots & `preferred_times`

Every weekly time slot in the database is a string in one canonical format:

```
<Day> <HH>:00      — 24-hour clock, zero-padded, on the hour
```

- Days: `Mon`, `Tue`, `Wed`, `Thu`, `Fri`, `Sat`, `Sun`
- Hours: `00:00` through `23:00`
- Valid examples: `Mon 17:00`, `Wed 19:00`, `Sat 10:00`, `Sun 15:00`
- Invalid: `Mon 5pm`, `mon 17:00`, `Mon 17:30`, `Monday 17:00`

Where slots live and how the fields relate:

| Field | Meaning |
|---|---|
| `users.available_times TEXT[]` | slots a user is generally free (2–4 per seeded user) |
| `schedules.slot` | the same availability, normalized to one row per user per slot (derived 1:1 from `users.available_times`) |
| `requests.preferred_times TEXT[] NOT NULL DEFAULT '{}'` | **canonical multi-slot field** — all slots the author picked in the "Post a Request" form (e.g. Request 1 → `{"Mon 17:00","Wed 19:00"}`); empty array means the author skipped the optional selector |
| `questions.preferred_time TEXT` | legacy single slot kept for backward compatibility (`get_questions.py`, `find_matches.py`); always equals the **first** entry of `questions.preferred_times` |
| `questions.preferred_times TEXT[] NOT NULL DEFAULT '{}'` | the full multi-slot list for the question (≥ 2 slots per seeded row) |

Seed guarantees for matching practice: every seeded request/question has ≥ 2
preferred slots, `preferred_times` always overlaps the author's own
`available_times`, and Request 1 / Question 1 (`{"Mon 17:00","Wed 19:00"}`)
overlap mentor 501's availability on `Mon 17:00`.

### Compatibility objects for the current student queries

The student practice files run a few queries whose table/column names don't
match the product schema. Since `.py` files must never be modified, the seed
provides objects shaped after those queries so they work as written once the
student code connects to this database:

| Student query (file) | Provided by |
|---|---|
| `SELECT request FROM requests;` (`Python/analysis.py`) | `requests.request` column — mirrors each request's primary subject (Request 1 → `'Math'`) |
| `SELECT mentor FROM mentors;` (`Python/analysis.py`) | `mentors` view — mentor/both users with `name AS mentor` plus subjects, location, available_times, languages, grade_level, teaching_style, district_id |
| `SELECT schedules FROM schedules_db;` (`Python/scheduling.py`) | `schedules_db` view — `slot AS schedules` plus user_id, created_at |

These are read-only conveniences; the app itself never touches them.

## 7. Validation queries

```bash
psql mentor_connect_mock -c "SELECT COUNT(*) FROM users;"        -- 1000
psql mentor_connect_mock -c "SELECT COUNT(*) FROM requests;"     -- 750
psql mentor_connect_mock -c "SELECT COUNT(*) FROM districts;"    -- 32
psql mentor_connect_mock -c "SELECT COUNT(*) FROM tags;"         -- 22
psql mentor_connect_mock -c "SELECT COUNT(*) FROM questions;"    -- 720
psql mentor_connect_mock -c "SELECT COUNT(*) FROM reports;"      -- 108
psql mentor_connect_mock -c "SELECT COUNT(*) FROM blocks;"       -- 120
psql mentor_connect_mock -c "SELECT COUNT(*) FROM schedules;"    -- 3023
psql mentor_connect_mock -c "SELECT role, COUNT(*) FROM users GROUP BY role ORDER BY role;"  -- 50 both / 500 mentee / 450 mentor
psql mentor_connect_mock -c "SELECT id, email, role, location, available_times FROM users WHERE id IN (1, 501, 951);"
psql mentor_connect_mock -c "SELECT * FROM questions WHERE id = 1;"
psql mentor_connect_mock -c "SELECT * FROM requests WHERE id = 1;"
# preferred times ('Ddd HH:00' slots)
psql mentor_connect_mock -c "SELECT id, preferred_times FROM requests WHERE id = 1;"                     -- {"Mon 17:00","Wed 19:00"}
psql mentor_connect_mock -c "SELECT id, preferred_time, preferred_times FROM questions WHERE id = 1;"    -- Mon 17:00 | {"Mon 17:00","Wed 19:00"}
psql mentor_connect_mock -c "SELECT s1.slot FROM schedules s1 JOIN schedules s2 ON s1.slot = s2.slot WHERE s1.user_id = 1 AND s2.user_id = 501;"  -- Mon 17:00
psql mentor_connect_mock -c "SELECT * FROM blocks LIMIT 10;"
psql mentor_connect_mock -c "SELECT * FROM reports LIMIT 10;"
# compatibility objects (student query shapes)
psql mentor_connect_mock -c "SELECT request FROM requests LIMIT 5;"      -- subject names
psql mentor_connect_mock -c "SELECT mentor FROM mentors LIMIT 5;"        -- mentor names
psql mentor_connect_mock -c "SELECT schedules FROM schedules_db LIMIT 5;" -- time slots
```

## 8. Manual test pages (after logging in as `student001@test.edu`)

- `/recommendations` — Question ID **1** → Sophia Lee (501) ranks #1 with score 110
- `/scheduling` — User IDs **1** and **501** → shared slot `Mon 17:00` (shows the
  current `scheduling.py` bug until the student fixes it; the data is ready)
- `/practice-lab` — question 1 matching, block status
- `/analytics` — python-only page; renders student `analysis.py` output/errors
- `/requests`, `/districts` — product pages backed by the seeded rows

## 9. Regenerating

The file was generated deterministically (hash-of-id based, no wall-clock
randomness) — the same generator always produces a byte-identical file. Treat
`mentor_connect_mock_1000.sql` as the source of truth and edit/regenerate it as
one unit; don't hand-edit individual rows.

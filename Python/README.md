# Python backend (main API server)

This folder is the **main backend** for Mentor-Connect / PeerBridge. A single
FastAPI app (`main.py`) serves everything under `/api`:

- the product API (auth, users, districts, tags, requests, reports, blocks, stats)
- the student practice/matching endpoints (`/api/practice/*`, `/api/matches/*`)
- adapter endpoints that wrap the student practice files **without modifying
  them** (`/api/analytics/*`, `/api/python-reports/*`, `/api/scheduling/*`,
  `/api/admin/flagged-users`)

`artifacts/api-server/python/` is legacy — it is kept for reference but is no
longer the source of truth.

## Layout

| Path | Job | Editable? |
|---|---|---|
| `main.py` | FastAPI entrypoint, mounts all routers at `/api` | yes (infrastructure) |
| `db.py` | psycopg2 connection helper for the product routers | yes (infrastructure) |
| `routers/` | Product API routers (auth, users, districts, tags, requests, reports, stats, matches) | yes (infrastructure) |
| `api/routers/` | Adapter routers (practice, analytics, python_reports, scheduling, admin) | yes (infrastructure) |
| `api/adapters/` | Safe wrappers + DB fallbacks around the student files | yes (infrastructure) |
| `migrations/001_practice_additive.sql` | One-time additive migration (questions table + availability columns + demo seed) | yes |
| `find_matches.py`, `get_users.py`, `get_questions.py`, `database.py`, `integration_api.py`, `app.py` | Student/algorithm files (working) | **no — student practice code** |
| `analysis.py`, `reports.py`, `scheduling.py`, `get_blocks.py`, `spamlblock.py` | Student practice files (currently broken; wrapped by adapters) | **no — student practice code** |
| `create_tables.sql`, `seed_demo_data.sql` | Standalone practice schema. **Do not run against the product DB** (they DROP tables). Use `migrations/001_practice_additive.sql` instead. | no |

`app.py` (the old standalone practice server) still works on its own, but its
routes are now also served by `main.py` under `/api/practice/*`, so you only
need one server.

## Setup

```bash
# from the repo root (reuses the repo-level virtualenv)
.venv/bin/pip install -r Python/requirements.txt

# or with a local venv inside Python/
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

Create `Python/.env` from the template (the real `.env` is gitignored and never
committed):

```bash
cp Python/.env.example Python/.env
```

Then edit `DATABASE_URL` to match your local PostgreSQL user/database:

```env
DATABASE_URL=postgresql://USER@localhost:5432/test_db
SESSION_SECRET=dev-secret-change-me
PORT=8000
```

One-time database migration (additive only — safe to re-run):

```bash
psql "$DATABASE_URL" -f Python/migrations/001_practice_additive.sql
```

## Run

```bash
cd Python
python main.py            # http://localhost:8000  (PORT env var overrides)
# or: uvicorn main:app --reload --port 8000
```

Frontend dev server (proxies `/api` to `localhost:8000`):

```bash
cd artifacts/peerbridge
PORT=5173 BASE_PATH=/ pnpm dev
```

## Endpoint catalog

Product API (unchanged): `/api/auth/*`, `/api/users/:id`, `/api/districts*`,
`/api/tags`, `/api/requests*`, `/api/reports`, `/api/blocks*`,
`/api/stats/*`, `/api/healthz`.

Student-code integrations:

| Endpoint | Wraps | Frontend page |
|---|---|---|
| `GET /api/practice/status`, `/api/practice/matching/:id`, `/api/practice/locations/*`, `/api/practice/blocks/status`, `/api/practice/raw/:module` | `integration_api.py` → `find_matches.py`, `locations.py`, `get_blocks.py` | `/practice-lab` |
| `GET /api/matches/:questionId`, `POST /api/matches` | `find_matches.py` | `/recommendations` |
| `GET /api/analysis/status`, `GET /api/analytics/{weekly-matches,popular-subjects,popular-time-slots,mentor-response-rates}` | `analysis.py` (+ `scheduling.py` for time slots) | `/analytics` |
| `GET /api/python-reports/{status,summary}` | `reports.py` | `/admin/reports` (New sign-ups card) |
| `GET /api/scheduling/{status,overview}`, `GET /api/scheduling/suggest?user_a=&user_b=` | `scheduling.py` | `/scheduling` |
| `GET /api/admin/flagged-users` | `get_blocks.py` | `/admin/reports` |

## The adapter contract (`source` field)

Adapter endpoints never fail just because a student file is broken. Each
response is an envelope:

```json
{
  "ok": true,
  "feature": "analytics.popular_subjects",
  "source": "student-module" | "adapter-fallback",
  "student_module": {
    "module": "analysis",
    "attempted_function": "receive_most_popular_subject",
    "importable": false,
    "called": false,
    "status": "syntax error",
    "error": "SyntaxError: invalid syntax (analysis.py, line 27)",
    "available_functions": []
  },
  "student_result": null,
  "data": [ ...real data... ]
}
```

- `source: "student-module"` — the student function ran and returned usable
  data; `data` is that result.
- `source: "adapter-fallback"` — the student module failed to import or run
  (details in `student_module`); `data` is equivalent real data computed by
  the adapter from the product database.

Student modules are re-imported **per request** (same mechanism as
`integration_api.py`), so fixing e.g. `analysis.py` flips the endpoints to
`student-module` immediately — no server restart needed. The dashboards show
which source is live via a green/amber badge.

## Current student-module status (as of this integration)

- `find_matches.py` — working; returns real ranked matches.
- `scheduling.py` — imports, but both functions fail at call time
  (`receive_time_data` connects to a bogus host, `time_dict` raises
  `NameError`). Adapter overlap fallback is used.
- `analysis.py`, `reports.py`, `get_blocks.py` — syntax errors; cannot be
  imported. Adapter fallbacks are used and the exact error is surfaced in the
  API response and the UI.
- `spamlblock.py` — broken imports/module-level code; not wired to any
  endpoint yet.

## Notes

- Two PostgreSQL drivers coexist on purpose: the product routers use
  `psycopg2` (`db.py`), the student files use `psycopg` v3 (`database.py`).
- Adapter endpoints are public (same as the stats router). Follow-up:
  `/api/admin/flagged-users` exposes user emails and should eventually be
  gated behind an admin session check.

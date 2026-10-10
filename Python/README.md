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

Run these commands in three separate terminals, all from the repository root.
Use Node `24.21.0` (`nvm use 24.21.0`) and pnpm `10.33.0` in the Node terminals.
The API requires `DATABASE_URL` and `SESSION_SECRET` in `Python/.env`, and the
configured PostgreSQL server must be running. Keep an existing populated DB;
starting the app does not require resetting or re-seeding it.

```bash
# Terminal 1 — Python API (private upstream)
.venv/bin/python -m uvicorn main:app --app-dir Python --reload --host 127.0.0.1 --port 8181
```

```bash
# Terminal 2 — API gateway
NODE_ENV=development GATEWAY_PUBLIC_ORIGIN=http://localhost:5173 GATEWAY_UPSTREAM_ORIGIN=http://127.0.0.1:8181 PORT=8080 pnpm --filter @workspace/api-gateway dev
```

```bash
# Terminal 3 — frontend
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/peerbridge dev
```

Open **http://localhost:5173**. Use `localhost` to match the gateway's exact
public origin. Vite proxies `/api` and `/ws` to the gateway on port 8080.

```bash
curl --fail http://127.0.0.1:8181/api/healthz
curl --fail 'http://localhost:5173/api/districts?type=high_school'
```

Both checks should return HTTP 200; the second returns your DB's district list
(32 high-school districts with the local mock dataset). A gateway `/livez` 200
only confirms that process is running. Source-mode `/readyz` may stay 503
without release metadata and the separate readiness DB credentials.

If startup fails, read the final line of the Python traceback. The chat router
uses the existing psycopg2 helpers; SQLAlchemy is not a required dependency.
Stop each process with Ctrl+C.

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

### Location lesson

`locations.location_data(student, mentor, question)` compares trimmed,
case-folded location labels and returns a sorted, deduplicated intersection.
The practice form posts the following to `/api/practice/locations/test`:

```json
{
  "student": {"id": 1, "locations": ["San Jose"]},
  "mentor": {"id": 2, "locations": ["San Jose", "Cupertino"]},
  "question": {"id": 1, "subject": "math"}
}
```

The existing success envelope identifies `function_called: "location_data"`
and contains `result: {"compatible": true, "overlap": ["san jose"]}`.
Disjoint or missing labels return `{"compatible": false, "overlap": []}`
with `success: true`. Each person accepts `locations: list[str]` or a single
`location: str`; the list takes precedence, including an empty list. Omit
missing fields or use `[]`. Supplied nulls, incorrect types, and blank labels
raise `ValueError`, surfaced by the existing failure envelope. All three
arguments must be objects; question content is unused. This lesson makes no
geographic inference and performs no database or network calls.

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

# Python backend (main API server)

This folder is the **main backend** for Mentor-Connect / PeerBridge. A single
FastAPI app (`main.py`) serves everything under `/api`:

- the product API (auth, users, districts, tags, requests, reports, blocks, stats)
- the student practice/matching endpoints (`/api/practice/*`, `/api/matches/*`)
- adapter endpoints that validate results from completed student practice files
  (`/api/analytics/*`, `/api/python-reports/*`, `/api/scheduling/*`,
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
| `api/adapters/` | Validated student results; explicit module failures | yes (infrastructure) |
| `migrations/001_practice_additive.sql` | Historical practice migration; use the canonical product migration ledger | reference only |
| `find_matches.py`, `get_users.py`, `get_questions.py`, `database.py`, `integration_api.py`, `app.py` | Student/algorithm files (working) | yes (student lessons) |
| `analysis.py`, `reports.py`, `scheduling.py`, `get_blocks.py`, `locations.py`, `mentor_ranks.py` | Completed student lessons with real result tests | yes (student lessons) |
| `spamlblock.py` | Inactive historical exercise; no runtime endpoint | reference only |
| `create_tables.sql`, `seed_demo_data.sql` | Standalone practice schema. **Do not run against the product DB** (they DROP tables); use the canonical migration procedure. | no |

`app.py` (the old standalone practice server) still works on its own, but its
routes are now also served by `main.py` under `/api/practice/*`, so you only
need one server.

## Setup

```bash
# from the repo root; uv 0.11.16, Python 3.12+
uv sync --frozen --group dev
pnpm install --frozen-lockfile
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

The product schema is canonical version `0003_request_events`. Follow the
[guarded migration runbook](../docs/runbooks/database-schema-and-migrations.md)
and [completion runbook](../docs/runbooks/backend-completion.md) for backup,
rollout and rollback. Do not run the standalone practice schema, seed, or old
practice migration against a populated product database.

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

## Result contract and lesson status

Matching, analytics, scheduling, reporting, block helpers and location tests now
return actual completed module results. Analytics and scheduling envelopes use
`source: "python"`; reporting and moderation use `source: "student-module"`.
A successful adapter envelope has `ok: true`, `success: true`, `error: null`,
importable/called module metadata and validated `data`. Status endpoints check
imports and do not call an aggregate. Empty arrays, zero counts and empty overlaps
are successful data. Required happy paths never select `adapter-fallback`.

Import/runtime/invalid-output failures remain explicit `ok: false`,
`success: false`, `data: null` responses, with safe public diagnostics and retry
controls. Injected failure tests preserve these teaching states without requiring
actual lesson sources to remain broken. Student modules reload per request under
an import lock, so edits appear without a server restart.

`mentor_ranks.py` completes all six missions; its independent reference is
`mentor_ranks_answer.py`. Rank endpoints run through the lesson server separately
from `main.py`; both suites are mandatory in the release gate. `spamlblock.py`
is inactive historical exercise code and is not imported by the active runtime.

Analytics observe events beginning at the migration's persistent tracking marker.
Earlier weeks are untracked (null), the first observed week may be partial, and
complete weeks contain observed counts. Historical matched requests are never
backfilled. Time-to-match averages omit invalid durations; they are not mentor
reply latency. Zero matches display “No observed matches”; positive counts with
no valid durations display “No valid time-to-match data”.

## Verification and runtime bounds

See [backend completion](../docs/runbooks/backend-completion.md) for the synthetic
acceptance sequence and nine permanent regression suites. The runner creates
and removes disposable PostgreSQL clusters; it requires PostgreSQL 16 tools,
Node 24.21.0, pnpm 10.33.0 and the locked Python environment. The gateway and
Python API are actual loopback processes during completion tests. Browser
interception tests remain complementary UI coverage.

Keep one Python worker and one gateway process. DMs return the latest 50 visible
messages, oldest first within that window; older stored messages remain intact,
and only selected incoming messages receive read receipts. Full-text history
pagination and multiworker WebSocket broadcasting are outside this release.

The product routers use psycopg2 and the student matching/database helper uses
psycopg v3; both are locked prerequisites. Gateway session/Origin checks and
privacy projections remain required: member profiles reveal only names,
subjects and join dates; moderation results omit emails/districts. Python stays
private on loopback. Local verification does not establish production readiness
or deploy the application.

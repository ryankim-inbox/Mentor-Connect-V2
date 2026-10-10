# Backend completion gate

This gate verifies completed lessons and product behavior using synthetic accounts
and disposable PostgreSQL 16 databases. It does not deploy, inspect a populated
database or establish production hosting, credentials, readiness or ingress headers.
Use the separate [classroom release procedure](classroom-release.md) for deployment.

## Prerequisites and checks

Use Node 24.21.0, pnpm 10.33.0, uv 0.11.16, Python 3.12+ and PostgreSQL 16 tools
(`initdb`, `pg_ctl`, `createdb`, `pg_dump`, `pg_restore`, `psql`) on `PATH`.
Install prerequisites from their locks before running the focused checks:

```sh
pnpm install --frozen-lockfile
uv sync --frozen --group dev
node scripts/test-verify-release.mjs
sh scripts/test-python.sh tests/test_backend_completion.py -q
sh scripts/test-python.sh
MENTOR_RANKS_MODULE=mentor_ranks sh scripts/test-python.sh tests/test_mentor_ranks.py -q
CLASSROOM_TEST_PYTHON="$PWD/.venv/bin/python" pnpm --filter @workspace/db test
pnpm api:contract-test
pnpm test:gateway
pnpm build:release
pnpm exec playwright test e2e/learning-surface.spec.ts e2e/classroom-flow.spec.ts
pnpm exec playwright test e2e/learning-states.spec.ts -g 'report thresholds recommend review'
pnpm verify:release
```

The release entrypoint installs locked Node/Python prerequisites, clears an ambient
`MENTOR_RANKS_MODULE` for the reference/default full suite, then explicitly selects
`mentor_ranks` for its separate suite. Both failures propagate. The Python runner
preflights both psycopg drivers, pytest, uvicorn and websockets, checks the canonical
schema, creates a private loopback cluster and cleans it up on exit. Missing tools
and failed tests stop verification. Required database and completion checks must
have zero skips; inspect summaries instead of accepting HTTP 200 alone.

The gate syncs only the explicit `UV_PROJECT_ENVIRONMENT` (default checkout `.venv`).
It defaults `PYTHON_BIN` to that environment's interpreter and exports the selected
interpreter as `CLASSROOM_TEST_PYTHON` so the canonical bootstrap suite exercises
the real API instead of skipping it. A separate `PYTHON_BIN` override is supported
but must already contain compatible locked prerequisites; the preflight rejects
missing imports. No writable environment is inferred from an interpreter path.
CI exports its explicit isolated virtualenv and both interpreter variables.

`tests/test_backend_completion.py` compiles every repository Python source under
`Python/` without importing it. Its real gateway flow covers registration/login,
profile clear/privacy, request create/page/filter/edit/match/delete, exactly one
observed event, blocked recommendations, reports, room/DM persistence and errors,
and successful nonempty/empty learning results. Actual gateway/Python room and DM
WebSocket coverage is in `tests/test_backend_completion.py`, alongside retained
direct Python socket tests in `tests/test_chat_integration.py`. Rank endpoints
are exercised separately through the lesson server. Injected error-envelope/UI tests remain alongside
these healthy-path tests.

| Original finding | Permanent regression |
| --- | --- |
| Oversized request feed | `tests/test_request_feed.py` |
| Blocked recommendations | `tests/test_matching_blocks.py` |
| Concurrent DM creation | `tests/test_chat_integration.py` |
| Invalid request writes become 500 | `tests/test_backend_input_validation.py` |
| Cannot clear bio | `tests/test_profile_updates.py` |
| Unified district filter ignored | `tests/test_district_filters.py` |
| District tags use global counts | `tests/test_district_statistics.py` |
| Concurrent student imports | `tests/test_module_reload.py` |
| Unbounded DM history | `tests/test_dm_history.py` |

`pnpm verify:release` retains code-generation reproducibility, canonical bootstrap
and backup/restore tests, contract/boundary checks, build and browser verification.
The Python freeze remains scoped to `codex/learning-tasks-21-24`; other branches
can complete student assignments. The separate CI high/critical dependency audit
policy is unchanged and remains a release requirement.

## Match observation and migration

Canonical version `0003_request_events` adds append-only matched events and a
singleton tracking marker. Back up the approved target and rehearse restore,
then follow the guarded dry-run and approved migration procedure in the
[schema runbook](database-schema-and-migrations.md#observed-match-tracking-and-rollout).
Never modify checksum-pinned migrations `0001` or `0002`.

Pause Connect writes before applying the migration, and keep them paused until
the event-writing backend is healthy, readiness confirms the `0003` ledger tail
from release metadata, and a synthetic Connect persists exactly one event.
The marker begins observation. Do not backfill historical matched rows, reset
the marker or discard events. Backups/restores retain both marker and events.
On rollback to code without tracking, pause Connect writes until tracking code
is restored; leave the additive schema and history intact.

Weekly analytics label earlier coverage `untracked` with null counts, the initial
week `partial` when appropriate, and subsequent observed weeks `complete` to date.
Time-to-match measures Connect latency, not reply latency; invalid durations are
excluded from averages. Zero matches and a positive count without valid durations
have distinct “No observed matches” and “No valid time-to-match data” labels.
Reports and moderation are real student results, with explicit failure envelopes
and no substitute aggregates. Thresholds recommend review; they do not suspend
accounts. Location matching compares normalized labels without geographic lookup.

## Legacy oversized request detail

Lists return bounded UTF-8 previews and disclose truncation. Detail reads preserve
full historical text and may exceed the gateway's 2,097,152-byte response ceiling.
Do not raise the ceiling, silently truncate stored text, reseed or bulk-repair data.
An operator with separately approved database access should identify the specific
request ID and inspect its byte lengths through the configured connection using
parameters, for example in an approved private Python/database session:

```python
with conn.cursor() as cur:
    cur.execute(
        "SELECT id, octet_length(title), octet_length(description) "
        "FROM requests WHERE id = %s",
        (request_id,),
    )
    sizes = cur.fetchone()
```

If the gateway cannot transport the detail, export/read only the identified row
using approved database tooling into a private file. Preserve an original backup
before any explicitly approved targeted repair. The author may instead replace
the identified title/description through authenticated PATCH with valid bounded
text (title 1–200 UTF-8 bytes; description 1–4000). Inspect raw byte lengths before
trimming; whitespace-only text is invalid. Preserve the full original privately
before replacing it. This gate exercises that limitation only on synthetic data.

## Runtime bounds and release evidence

Keep one Python worker and one gateway process for the approximately 20-user
classroom. Python binds loopback; authenticated gateway forwarding, Origin
checks, privacy redaction, rate limits and the response ceiling remain required.
DM reads return the latest 50 nondeleted messages in ascending order within that
window. Only selected incoming messages get read receipts; older stored history
remains intact. Full-text history pagination, multiworker broadcasting, production
hosting/credentials, account suspension policy, historic reconstruction and legacy
backend activation are outside this implementation.

Record exact commands, counts, skips, code-generation diff and backup/restore
results, alongside independent review status and any tooling/dependency failures.
The tracked [execution results](../superpowers/plans/2026-10-10-backend-completion-results.md)
carry local evidence and known limitations. A successful local gate does not
replace separate final review or the provider/deployment release record.

# Task 10 report — integrity constraints, indexes, and convergent preflight

## Status and commits

Implemented in commit `6712f4c5` (`Slice 10: enforce database integrity
preflight`). This report is committed separately so it can cite the immutable
implementation commit.

Canonical schema version `0002` now enforces the new self-relation and ordered
DM invariants, adds matching indexes, and provides deterministic read-only
preflight, constraint-catalog verification, EXPLAIN verification, and a
dry-run-only apply surface. No staging or production database was accessed or
mutated. No `Python/**` or `.py` path changed.

Staging/production preflight, plan, p95, and index lock-time evidence remain
`[UNKNOWN]`. Production application remains forbidden before Slice 11.

## Implementation

### Forward migration and canonical ledger

- Added append-only migration
  `database/migrations/0002_integrity_constraints_indexes.sql`; immutable
  `0001_canonical_baseline.sql` was not edited.
- Added and validated `blocks_no_self_check`, `reports_no_self_check`, and
  `dm_conversations_canonical_pair_check (user_a_id < user_b_id)` using
  `NOT VALID` followed by `VALIDATE CONSTRAINT`. Existing baseline uniqueness
  on block pairs, request-tag pairs, and ordered DM pairs remains authoritative.
- Added `idx_users_matching_lookup (district_id, role, is_verified, id)` and
  partial `idx_requests_open_matching_lookup (district_id, role, created_at
DESC, id) WHERE status = 'open'`.
- Recorded forward, verification, transactional rollback, committed-state
  roll-forward, Slice 11 production prohibition, and unknown lock/p95 status in
  the migration itself.
- Appended checksum
  `53adbe10adee136e6217515201288a7c992234a19cc8b82368ea662364443e24`
  to the ordered ledger.
- Regenerated `canonical.sql` as the exact bytes of migration 0001 followed by
  migration 0002. Canonical SHA-256 is
  `a6b24112cdf3b4709ecdc11e0c4abbe9b2ee85ba25cfbe49fd841ed14e2ff8f9`.
- Reproduced the empty schema in a disposable loopback PostgreSQL cluster and
  refreshed the frozen catalog: 13 tables, 86 columns, 46 constraints, and 39
  indexes; catalog SHA-256 is
  `0bd82842dd4c434072de30c154147c40a76b4d2d8144a0c11a0314bae99969e2`.
- Advanced `version.json` to the ledger tail and pinned staging/production
  preflight, plan, p95, and index lock-time fields to `[UNKNOWN]`. Asset
  verification rejects unsupported evidence claims.

### Read-only preflight and quarantine evidence

- Added `runIntegrityPreflight(client)`. It begins `TRANSACTION READ ONLY`,
  sets transaction-local `public, pg_catalog` search path, verifies
  `transaction_read_only=on`, and commits or rolls back without writes.
- It deterministically reports invalid user/request roles, request status, and
  chat-room type; duplicate block/request-tag/canonical-DM pairs; self block
  and report rows; non-canonical DM order; and all 19 foreign-key orphan
  relationships.
- Evidence contains per-check counts and ordered candidate row IDs/pairs plus
  `cleanupPerformed: false`, a flattened quarantine candidate list, and
  `approvalTaskRequired`. Nonzero violations cause the CLI to exit
  unsuccessfully. No cleanup, pair rewrite, delete, or quarantine-table write
  occurs.
- The runbook requires storing that output as release evidence and opening a
  separate owner/approval remediation task before rerunning preflight.

### Safe command surfaces

Added the required package commands:

- `pnpm --filter db migration:preflight -- --env <target>`
- `pnpm --filter db migration:apply -- --env <target> --dry-run`
- `pnpm --filter db constraints:verify -- --env <target>`
- `pnpm --filter db explain:verify -- --env <target>`

All require exactly one `local`, `staging`, or `production` scope. Local
inspection accepts loopback hosts only, including normalized IPv6 `::1`.
Remote inspection requires the exact environment-specific
`MIGRATION_ALLOWED_HOSTS_<ENV>` entry. URLs and credentials are not printed.

`migration:apply` accepts only `--dry-run`, validates the repository and target
binding, and deliberately opens no database connection. It cannot reach the
mutating runner. Task 8's root launcher was unchanged and remains dry-run-only,
approval/backup/actor aware, environment allowlisted, and dependent on the
trusted append-only audit file descriptor.

`constraints:verify` compares the complete target constraint catalog with the
frozen catalog. `explain:verify` runs JSON EXPLAIN without ANALYZE and checks
six representative email, district, status, request-tag, user-matching, and
open-request plans for their expected indexes.

### Schema representation and documentation

- Updated Drizzle definitions with all three checks and both indexes. The
  existing catalog-vs-Drizzle test verifies every constraint and
  non-constraint index.
- Added `docs/runbooks/database-integrity-preflight.md` with exact commands,
  environment safety, evidence shape, quarantine workflow, complete deletion
  policy, plan limits, index-lock/concurrent strategy, and forward recovery.
- Updated the canonical schema runbook and database README for version 0002.

## Strict TDD RED/GREEN evidence

### Cycle 1 — command and target safety contract

- Expected RED: `node --test lib/db/test/integrity-tool.test.mjs` reported 0/4
  passing after import stubs were introduced. Failures were the explicit
  `environment argument parsing is not implemented`, target validation not
  implemented, empty nested-plan index list, and missing `migration:apply`
  command branch.
- Incremental GREEN: after minimal parser, target binding, plan walker, and
  dry-run command implementation, 3/4 passed; the remaining expected failure
  reported schema `0001` instead of required `0002`.
- Final GREEN: after advancing the ledger/materialization, the focused suite
  reported 4/4 passing.

### Cycle 2 — migration, Drizzle, preflight, catalog, and plans

- Expected RED: `pnpm --filter db exec tsx --test
test/drizzle-schema.test.ts` reported 2 pass / 1 fail because blocks exposed
  no `blocks_no_self_check`.
- Expected RED: `sh lib/db/test/disposable-postgres.sh` reported 2 pass / 4
  fail: version remained `0001`, preflight and EXPLAIN verification were not
  implemented, and the migration did not reject a self-block.
- GREEN after the minimal migration/Drizzle/tool implementation and frozen
  asset refresh: the focused unit suite reported 11/11, Drizzle 3/3, and the
  disposable suite 6/6.

### Cycle 3 — all foreign-key orphan candidates

- Expected RED mutation: with the 19 orphan query specifications deliberately
  disabled, `sh lib/db/test/disposable-postgres.sh` reported 5 pass / 1 fail
  at missing `orphan_block_blocked_user` evidence.
- GREEN: restoring the read-only orphan queries made the disposable suite pass
  6/6. The fixture exercises every user, district, tag, request, room,
  conversation, and message foreign-key direction and verifies unchanged row
  counts.

### Cycle 4 — external evidence must remain unknown

- Expected RED: `node --test lib/db/test/schema-version.test.mjs` reported 0/1
  because `stagingPlanStatus: verified-without-evidence` was incorrectly
  accepted.
- GREEN: the asset verifier now requires all eight staging/production evidence
  fields to remain `[UNKNOWN]`; the focused test reported 1/1.

### Self-review bug cycle — IPv6 loopback normalization

- Expected RED: `node --test lib/db/test/integrity-tool.test.mjs` reported 3
  pass / 1 fail because Node returned `[::1]` and local target validation
  rejected it.
- GREEN: bracket normalization returns canonical `::1` without broadening the
  loopback set; the focused suite reported 4/4.

## Fresh verification before commit

- `pnpm --filter db test` — passed: 18 Node unit tests, 3 Drizzle tests, and 6
  disposable PostgreSQL integration tests; 27/27 total.
- `pnpm run typecheck:libs` — passed (`tsc --build`).
- `pnpm test:migrations` — passed Task 8 migration entrypoint and post-merge
  guards.
- `pnpm --filter db schema:check` — passed:
  `schema check: ok (version 0002, 13 tables, 2 migration)`.
- `pnpm exec prettier --check <all changed non-SQL source/docs/assets>` — all
  matched Prettier style.
- `git diff --check` — passed.
- Immutable migration/canonical audit — 0001 SHA-256 remained exactly
  `0b02984bba7f186a5a6f99b49695110c2b023b001cdd207f84d2ed82646a5dab`;
  both ledger migration hashes matched; canonical bytes exactly equaled the
  ordered concatenation.
- Python path guard — no changed path under `Python/**` and no changed `.py`
  file.
- Exact dry-run package invocation against an allowlisted non-resolving
  staging placeholder returned
  `migration apply: dry-run only; schema 0002; target staging; no database
connection or changes`; the password was not emitted and no connection was
  attempted.
- The three staging inspection commands were intentionally not run. Their
  results remain `[UNKNOWN]`; disposable local CLI coverage proved the same
  preflight, constraint, and EXPLAIN behavior with 0 violations, 0 catalog
  differences, and 6/6 expected plans.

## Files changed

Canonical and migration assets:

- `database/migrations/0002_integrity_constraints_indexes.sql`
- `database/migrations/ledger.json`
- `database/schema/canonical.sql`
- `database/schema/local-catalog.json`
- `database/schema/version.json`
- `database/README.md`

Database code and representation:

- `lib/db/package.json`
- `lib/db/tools/environment.mjs`
- `lib/db/tools/integrity.mjs`
- `lib/db/tools/schema-assets.mjs`
- `lib/db/tools/schema-cli.mjs`
- `lib/db/src/schema/chat.ts`
- `lib/db/src/schema/reports.ts`
- `lib/db/src/schema/requests.ts`
- `lib/db/src/schema/users.ts`

Tests and runbooks:

- `lib/db/test/integrity-tool.test.mjs`
- `lib/db/test/catalog.integration.test.mjs`
- `lib/db/test/drizzle-schema.test.ts`
- `lib/db/test/schema-tool.test.mjs`
- `lib/db/test/schema-version.test.mjs`
- `docs/runbooks/database-integrity-preflight.md`
- `docs/runbooks/database-schema-and-migrations.md`
- `.superpowers/sdd/RELEASE_SLICES_NON_PYTHON_01_20/task-10-report.md`

No file under `Python/**`, `Python/create_tables.sql`,
`Python/migrations/**`, or any `.py` file was created, modified, deleted, or
moved.

## Self-review

- Confirmed the ordered ledger is still authoritative, 0001 is byte-identical,
  0002 is checksum-pinned, and canonical SQL is only the generated
  concatenation.
- Confirmed new checks are represented identically in PostgreSQL catalog and
  Drizzle; the canonical ordered DM check plus the existing unique pair blocks
  both reversed and duplicate rooms.
- Confirmed preflight covers every new invariant plus every existing enum,
  pair uniqueness, and foreign-key invariant requested by the brief.
- Confirmed violating fixtures produce deterministic quarantine candidates and
  the read-only tool leaves all observed row counts unchanged.
- Confirmed migration failure preserves both violating data and the
  one-migration ledger prefix; no automatic cleanup path exists.
- Confirmed constraint verification compares actual catalog semantics and plan
  verification traverses nested JSON plans, rather than grepping source.
- Confirmed only disposable loopback PostgreSQL clusters were mutated. No
  shared local, staging, or production database was used.
- Confirmed the existing runner's transaction-control scanner, transaction-
  local search path, advisory lock, immutable applied prefix, and rollback
  behavior remain covered and green.
- Confirmed there is still no reachable real-apply CLI. The new apply-named
  package command is fail-closed and dry-run-only; the Task 8 trusted-launcher
  audit guard was not modified.
- Confirmed docs explicitly separate local plan-shape evidence from remote p95
  and lock evidence and define the concurrent roll-forward requirement for a
  remotely large index.

## External `[UNKNOWN]` blockers and residual risks

- **Staging preflight `[UNKNOWN]`:** an authorized staging reader must run the
  exact preflight command and obtain zero unexpected violations. Any candidate
  requires quarantine and a separately approved remediation task.
- **Staging/production catalog and plans `[UNKNOWN]`:** catalog parity and
  environment-specific planner choices require authorized remote inspection.
- **Staging/production p95 `[UNKNOWN]`:** EXPLAIN without ANALYZE is
  intentionally non-executing and does not establish latency or regression
  thresholds.
- **Index size/lock time `[UNKNOWN]`:** version 0002 uses transactional index
  builds because the reviewed runner is atomic. Before remote application,
  operators must measure relation size and lock time. A large index or missed
  lock window requires an approved higher-numbered concurrent roll-forward
  and approved non-transactional path; it must not be forced through the
  current runner.
- **Production application forbidden:** Slice 11 recovery rehearsal,
  environment approval/backup evidence, and trusted-launcher audit controls
  remain mandatory. No production apply was attempted or enabled.

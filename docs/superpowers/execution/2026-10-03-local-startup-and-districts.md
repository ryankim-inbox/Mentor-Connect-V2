# Startup and district recovery — execution record

Approved plan: `docs/superpowers/plans/2026-10-03-local-startup-and-districts.md`.
Implemented inline with a fresh whole-branch reviewer. Product changes use existing dependencies and preserve the developer database.

## Validation

- Original startup regression: failed at SQLAlchemy import before implementation.
- New district browser tests: 7 failed against the original UI before implementation.
- Final branch based on `origin/main` at `1b610673`: 39 related backend tests passed, no skips; 26 related Playwright tests passed.
- `CHAT_TEST_ADMIN_DSN='dbname=postgres host=127.0.0.1' .venv/bin/python -m pytest -q tests/test_chat_missions_1_6.py tests/test_chat_integration.py`.
- `pnpm exec playwright test e2e/register-districts.spec.ts e2e/auth.spec.ts`.
- `pnpm exec tsc -b lib/api-client-react`, frontend typecheck/build and gateway build succeeded.
- Real existing PostgreSQL database → Python → gateway → Vite → headless browser: 32 districts, selected district text, search response and selection reset verified. No registration or data write. Test processes stopped afterward.
- Only related tests ran, per the user's request.

## Final review

Fresh reviewer: gpt-6-astra, high reasoning. Reviewed production code, tests, surrounding contracts, run documentation and all five Review Focus items. Verdict: ready to merge; no Critical, Important or Minor findings. The unchanged excluded behaviors considered by the reviewer are recorded below.

## Rulings I made

- Ruling: Use inline execution with one fresh whole-branch subagent review — user invoked both executor skills and approved the recommended Native approach — cost if wrong: per-task independent reviews are deferred until final review.
- Ruling: Run only related checks, not repository-wide suites — explicit user request overrides generic skill full-suite defaults — cost if wrong: unrelated regressions are outside this validation.
- Ruling: Replace mirrored formatter expectation with literal payload — tests must catch formatting regressions — cost if wrong: fixture maintenance only.
- Task 2: Ruling: Build referenced api-client-react declarations before frontend typecheck — fresh worktree lacks generated dist/index.d.ts (TS6305) — cost if wrong: one extra prerequisite build, no source change.
- Task 2: Ruling: Use isolated ports 25173/28080/28181 for the real-stack browser check — user's primary Vite/gateway already occupy 5173/8080 — cost if wrong: documented default ports are not exercised by this smoke check; identical proxy and exact-origin relationships are exercised.
- Task 2: Ruling: Reuse the successful 26-test run for completion instead of rerunning unchanged code through task-done — developer instruction prohibits redundant checks without new changes — cost if wrong: wrapper bookkeeping is recorded manually.
- Final: Ruling: Rebase our three commits onto origin/main and include only the relevant unpublished integration harness — local main contains unrelated Temp mentor-rank additions, while remote main has a separate mentor update — cost if wrong: branch base changes and focused checks must rerun; original local work remains untouched.
- Final: Ruling: Leave existing room latest-50 selection unchanged — outside the approved startup/district/DM repair and reviewer confirmed unchanged — cost if wrong: long room history still needs its separate fix.
- Final: Ruling: Leave concurrent DM-start race unchanged — existing separate endpoint and excluded from this plan — cost if wrong: simultaneous first-time starts can still race.
- Final: Ruling: Retain the existing single-process socket and handshake-session architecture — restore DM using the same room socket contract without auth/distributed redesign — cost if wrong: cross-worker fanout and immediate logout revocation remain unsupported.
- Final: Ruling: Accept isolated-port live evidence and inspection of the default port configuration — preserve the user-run dev servers — cost if wrong: contention specific to 5173/8080 requires a later local restart check.

## Deferred minors

None.

## PR scope

The original local main contained unrelated unpublished mentor-rank work and a local integration harness. Only this fix's commits were rebased onto remote main. The relevant harness coverage is included in this PR; its unrelated room-history/concurrent-start tests and all mentor-rank work remain untouched in the original checkout. Commit IDs in temporary pre-rebase test records refer to their earlier equivalents; final production review covered `1b610673..a005cdc1`.

# Backend completion execution results

Local synthetic verification on 2026-10-10, based on Task 16 baseline `12b2e4aa`.
Tasks 1–15 were implemented and reviewed individually before this gate. This
record preserves execution evidence; plan checkboxes remain unchanged, and
independent final whole-branch review is pending.

## Implemented scope

- Bounded UTF-8 request writes/previews and stable filtered cursor pagination;
  blocking in recommendations; race-safe DM creation and latest-50 DM reads.
- Input/reference errors return controlled 4xx responses; bio clears persist;
  unified district filtering and district-scoped tag counts use the intended data.
- Student imports serialize reloads and invalid diagnostics remain JSON-safe.
- Canonical `0003_request_events` records observed Connect events atomically,
  preserves its observation marker and never invents historical matches.
- Analytics, scheduling, signup reports, moderation summaries, block helpers,
  normalized location matching and all six mentor rank missions return real results.
- The completion gate composes the real Python server, gateway and disposable DB;
  compiles 43 repository Python sources without importing them; runs default and
  student rank suites; provisions locked dependencies and the canonical API test
  interpreter; retains generation, migration, restore, UI and boundary checks.

The original nine findings map to permanent suites in
[the completion runbook](../../runbooks/backend-completion.md). Earlier per-task
reports established focused RED/GREEN behavior; the final integrated checks below
exercise the completed branch. Browser fixtures remain complementary to the actual
gateway/Python completion flow, and injected failure-envelope tests remain intact.

## Final local verification

Commands run in the isolated backend worktree with Node 24.21.0 on PATH,
pnpm 10.33.0, uv 0.11.16, Python 3.12.13 and PostgreSQL 16.13. Only disposable
clusters and synthetic accounts were used. All named individual acceptance checks
and the committed full release gate passed.
The full gate ran on implementation commit `b5480098`; the subsequent amendment
changes only non-Python evidence. Its earlier uncommitted attempt is retained below
so that the initial failure is not hidden.

| Exact command | Result |
| --- | --- |
| `node scripts/test-verify-release.mjs` | Exit 0; release sequencing, environment provisioning and failure propagation assertions passed. |
| `sh scripts/test-python.sh tests/test_backend_completion.py -q` | 2 passed, zero skipped; real module success/data, privacy and source compilation. |
| `sh scripts/test-python.sh` | 324 passed, zero skipped; includes 45 default/reference rank checks and all nine regressions. |
| `MENTOR_RANKS_MODULE=mentor_ranks sh scripts/test-python.sh tests/test_mentor_ranks.py -q` | 45 passed, zero skipped; actual student implementation and lesson endpoint checks. |
| `CLASSROOM_TEST_PYTHON="$PWD/.venv/bin/python" pnpm --filter @workspace/db test` | 58 tests passed (26+3+8+14+7), zero skipped; four operator-command checks passed; schema 0003 catalog reproduced, guarded upgrade and real API bootstrap passed; native backup/restore matched all 14 table counts, full ledger and catalog. |
| `pnpm api:contract-test` | 48 Python/OpenAPI/gateway REST operations and 2 WS operations agree. |
| `pnpm test:gateway` | 109 gateway tests + 8 shield tests passed, zero skipped. |
| `pnpm build:release` | Exit 0; library/application typechecks and both release bundles passed. |
| `pnpm exec playwright test e2e/learning-surface.spec.ts e2e/classroom-flow.spec.ts` | 23 passed. |
| `pnpm exec playwright test e2e/learning-states.spec.ts -g 'report thresholds recommend review'` | 1 passed; threshold label and explicit module-error retry behavior. |
| `pnpm verify:release` (uncommitted attempt) | Exit 1: runtime checks 8 passed; freeze checks 7 passed/1 failed (`CLI passes against HEAD`) because `Python/README.md` and `tests/test_backend_completion.py` were uncommitted. Later gate stages did not execute in this attempt. No policy was weakened; superseded by the committed rerun below. |
| `pnpm verify:release` (committed rerun on `b5480098`) | Exit 0. Locked pnpm/uv setup, runtime 8, freeze self-tests 8, full Python 324, student ranks 45, gateway 109+8, mockup 1, canonical DB 58, frontend unit 3, smoke 4 and complete browser 63 all passed; zero skipped required checks. Migration entrypoint/post-merge, 154 API boundary checks, secret checks and generation with no generated diff also passed. Branch-scoped historical freeze checks correctly remained scoped to their original branch. |

The existing tooltip sourcemap diagnostic, NO_COLOR/FORCE_COLOR warnings and
intentional incompatible legacy-fixture notice recurred without failing these
checks. Generated browser output was cleaned; generated API clients had no diff.
No named acceptance command remains failed or pending. Independent final review
and the separately scoped dependency-audit CI job remain external evidence.

## Decisions

The controller's ruling entries are preserved verbatim:

> Ruling: Use subagent-driven execution when both execution skills were invoked — user named both; the long plan benefits from independent task reviews and the handoff recommended this method — cost if wrong: extra review contexts, no change in scope.

> Task 1: Ruling: Canonical cursor timestamps use YYYY-MM-DDTHH:mm:ss with optional 1–6 fractional digits and Z or numeric offset, plus a positive safe decimal ID — covers backend isoformat output while making gateway/Python validation consistent — cost if wrong: clients constructing other ISO variants receive 400/422 and must use emitted timestamps.

> Task 2: Ruling: Extend the fix to integration_api.get_matching_result so an explicit module is_real=False survives normalization — otherwise the failure envelope is labelled 'real result' by PracticeLab; aligns with A2's honest failure presentation — cost if wrong: consumers relying on overwritten provenance see the explicit module value instead. Add a regression before changing it.

> Task 4: Ruling: Update the existing mission-7 SQL fake in tests/test_chat_missions_1_6.py to select the bounded window before receipt updates — its old query-order expectation contradicts A3, while visible-message/receipt assertions must remain — cost if wrong: weaker regression coverage; retain behavior assertions and real-DB coverage.

> Task 5: Ruling: Apply A4 reference/input validation to existing block targets, report reason enum, resource path IDs and matching GET bounds as well as request bodies — the same public/DB constraints otherwise produce 500s or accept malformed inputs — cost if wrong: previously accepted malformed payloads receive documented 4xx; valid payloads/statuses stay unchanged.

> Task 6: Ruling: Assert cross-user PATCH as gateway 404 and direct-backend 403, preserving unchanged data — the brief mistakenly expected gateway 403, while existing gateway privacy masks profile-ID mismatch and constraints require preserving that protection — cost if wrong: one test/status expectation differs from plan; no public behavior change.

> Task 11: Ruling: Display "No observed matches" only when totalMatches is zero; if matches exist but every duration is invalid/negative, display "No valid time-to-match data" — B1 requires unknown durations and B2 must not falsely deny recorded matches — cost if wrong: one empty-state label differs from the blanket null-label wording, while recorded counts and null metrics remain unchanged.

> Task 13: Ruling: Extend the gateway flagged-users projector to permit data:null only on an explicit ok:false module envelope, preserving array redaction on success — otherwise the specified failure response becomes a gateway 502 — cost if wrong: one additional public failure shape is forwarded; malformed success data must still be rejected.

> Task 14: Ruling: Treat explicitly supplied null, wrong-type or blank location labels as malformed; only absent fields or empty lists mean no locations, and a supplied locations list takes precedence over location — preserves the spec's list/scalar types and avoids matching empty labels — cost if wrong: callers sending null/blank for missing data get an explicit practice failure and must omit the field or send [].

> Task 16: Ruling: Run locked uv sync into explicit UV_PROJECT_ENVIRONMENT or the project .venv, preserve PYTHON_BIN overrides with dependency preflight, and export CI's explicit environment path — never infer a writable installation directory from an arbitrary interpreter path — cost if wrong: a custom interpreter override may cause setup of an unused project environment and remains the operator's compatibility responsibility.

> Task 16: Ruling: Commit the task's already-tested changes with the full release gate explicitly pending, then run verify:release on the clean committed tree and amend only non-Python evidence afterward — the unchanged Python freeze test intentionally rejects uncommitted Python changes, so testing this gate before commit is circular — cost if wrong: a local provisional commit can contain a gate failure and must be fixed before completion; nothing is published.

## Known deferred minor categories

These earlier review entries are preserved for independent final-review triage;
this record does not declare them resolved:

> Task 1: minor (deferred): Browser output has NO_COLOR/FORCE_COLOR warnings; build sourcemap diagnostic also exists on baseline. No application failure.

> Task 3: minor (deferred): Schema checks print the existing legacy-fixture deployment diagnostic; informational safeguard retained.

> Task 4: minor (deferred): Same existing sourcemap/color-environment diagnostics recorded in Task 1; no added product defect.

> Task 6: minor (deferred): Existing legacy-fixture diagnostic, same as Task 3.

> Task 9: minor (deferred): Existing legacy-fixture diagnostic, same as Task 3.

> Task 11: minor (deferred): analysis adapter date fields accept arbitrary strings; shipped module emits valid dates, but student-edited invalid date strings can pass shape validation. Reviewer cites Python/api/adapters/analysis_adapter.py:33,103. Final review must triage.

> Task 11: minor (deferred): Existing sourcemap/color warnings recur; earlier occurrence established in controller Task1/4 reports, though Task4 full logs not available to reviewer.

> Task 12: minor (deferred): Existing NO_COLOR/FORCE_COLOR warnings recur.

> Task 13: minor (deferred): Existing tooltip sourcemap diagnostic omitted from implementer report but observed by reviewer; color-environment warnings recur. Controller baseline provenance retained from Task1/4/11.

> Task 14: minor (deferred): Existing NO_COLOR/FORCE_COLOR warnings recur.

## Operator limits and outstanding external evidence

- Analytics prior to the persistent tracking marker are untracked/null. Initial
  observed coverage may be partial; Connect latency is not reply latency.
- Pause Connect writes across migration rollout and any rollback to nontracking
  code. Preserve marker/events, immutable 0001/0002 checksums and approved backup
  evidence. Local backup/restore verification does not authorize target migration.
- Legacy full details can exceed the unchanged gateway response ceiling even when
  previews are bounded. Use the runbook's parameterized octet-length inspection,
  private backup/export and approved targeted repair or author PATCH; no bulk truncation.
- One Python worker and one gateway process remain required. DM history exposes
  only the latest 50 visible messages, oldest first within that window; older
  storage remains intact and only selected incoming messages get receipts.
- Production hosting, credentials, provider/ingress readiness, multiworker WS,
  historical reconstruction, account suspension, full-text history pagination and
  legacy backend activation were not performed or claimed.
- The separate dependency-audit CI job was not run locally; its result is unknown.
  Both existing high/critical audit policies remain unchanged, with no new exceptions.
- Independent final whole-branch review is pending. No push, merge or deployment
  was performed, and no populated database or primary checkout was touched.

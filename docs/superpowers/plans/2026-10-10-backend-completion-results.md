# Backend completion execution results

Local synthetic verification on 2026-10-10, based on Task 16 baseline `12b2e4aa`.
Tasks 1–15 were implemented and reviewed individually before this gate. This
record preserves execution evidence; plan checkboxes remain unchanged, and
independent final whole-branch review and scoped fix review are complete (see final review approval below).

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
No named acceptance command remains failed or pending. Independent final review is
complete below; the separately scoped dependency-audit CI job remains external evidence.

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
- Independent final review is complete after the fixes documented below. No push, merge or deployment
  was performed, and no populated database or primary checkout was touched.

## Final review remediation (2026-10-10)

The whole-branch review of `6fc77162` required two Important fixes and retained
one Minor date-validation issue. This section supersedes the earlier pending
whole-branch-review statement; the scoped follow-up review remains pending.
The historical runs and failed-attempt evidence above are unchanged.

- Important 1: Connect checks both block directions inside its existing locked
  transaction before updating the request or recording an event. Rejection is
  403, and a failed block read aborts the transaction. The gateway retains its
  private-error projection. Real gateway tests cover both request roles and
  block directions, unchanged state/timestamps/events, unblock then success,
  and a missing block table. Existing single-winner, rollback and rematch
  regressions remain in the verification scope. OpenAPI now documents 403.
- Important 2: the OpenAPI district query enum is `high_school|unified`; omitted
  type returns all supported districts and literal `all` remains invalid.
  All clients were regenerated. Permanent tests compare generated Zod and
  gateway validation, and query unified districts plus search through the real
  gateway and disposable database.
- Minor 3: analytics adapters validate canonical calendar dates and aware ISO
  timestamps with the standard library. Invalid dates, naive timestamps,
  malformed syntax and invalid offsets produce the existing invalid-output
  envelope. Valid emitted timestamps, empty arrays, nulls, zero values and
  unexpected-exception diagnostics retain their behavior.
- Header cleanup: the probe module now describes editable lessons and real
  reporting/moderation output; its compatibility helper was not refactored.

> Final review: Ruling: Enforce either-direction blocks inside Connect before any state/event write and return controlled403 — a block must prevent direct mentorship connection as well as recommendations; the final review demonstrated persisted blocked matches — cost if wrong: previously allowed blocked-pair Connect calls now fail until unblocked; valid unblocked calls stay unchanged.

The existing Task 16 provisional-commit ruling also applies to this fix wave.
Tested changes were committed as `9d060966`, then `pnpm verify:release` ran on
that clean code tree and exited 0. The subsequent amendment changes only this
non-Python evidence file. Scoped re-review remains pending; this local gate
is not a release, merge or deployment approval.

RED evidence is retained in the ignored plan workspace
`.superpowers/sdd/2026-10-10-backend-completion/`:

- `final-fix-red-python.log`: first focused attempt, 16 failed/62 passed. Four
  Connect cases initially failed at login because the test used an incorrect
  synthetic email; the actual canonical fixture email was then used.
- `final-fix-red-connect.log`: corrected Connect cases, 5 failed with actual
  200 instead of expected 403 (four blocked cases) or 500 (failed block read).
- `final-fix-red-contract.log`: generated/gateway parity, 2 failed/10 passed;
  generated schema rejected unified and accepted all.
- `final-fix-red-dates.log`: 14 malformed date/time cases failed, 3 valid cases
  passed. `final-fix-red-offset.log`: the initial date fix still accepted
  `+01:60` (1 failed/8 passed); timestamp syntax now rejects that normalization.
- `final-fix-generation.log`: initial generation failed on a mistaken response
  schema reference; it was replaced with the existing shared Error403 response.
  `final-fix-generation-green.log` records successful regeneration.

Focused GREEN verification (same Node/Python/PostgreSQL versions as above):

| Exact command | Result and log |
| --- | --- |
| `sh scripts/test-python.sh tests/test_request_events.py tests/test_python_only_adapters.py tests/test_district_filters.py tests/test_analysis.py tests/test_chat_integration.py tests/test_chat_missions_1_6.py tests/test_dm_history.py tests/test_backend_input_validation.py tests/test_backend_completion.py -q` | Exit 0; 184 passed, zero skipped, including real event/chat/Connect/adapter/district regressions and active-source compilation; `final-fix-green-focused-python.log`. |
| `pnpm test:gateway` | Exit 0; 114 gateway tests plus 8 shield tests passed, zero skipped; `final-fix-green-gateway.log`. |
| `pnpm api:contract-test` | Exit 0; all 48 Python/OpenAPI/gateway REST operations and 2 WS operations agree; `final-fix-green-contract.log`. |
| `pnpm build:release` | Exit 0; typechecks and both release bundles passed; existing tooltip sourcemap diagnostic retained; `final-fix-green-build.log`. |
| `pnpm api:generate` (corrected schema) | Exit 0; React and Zod generation succeeded; `final-fix-generation-green.log`. |
| `git diff --check` | Exit 0; no whitespace errors. |
| `sh scripts/test-python.sh` (final fixes, before commit) | Exit 0; 348 passed, zero skipped; `final-fix-green-full-python.log`. |
| `pnpm verify:release` (final fixes on clean `9d060966`) | Exit 0; runtime 8, freeze self-tests 8, full Python 348, student ranks 45, gateway 114+8 shield, mockup 1, canonical DB 58 plus four operator checks, frontend unit 3, smoke 4 and browser 63 all passed. Zero required skips. Locked installation, migration/post-merge checks, 48 REST/2 WS contract agreement, 154 boundary checks, secret checks and reproducible API generation also passed; `final-fix-verify-release.log`. Historical branch freeze checks retained their original branch scope. |

Final-review triage retains the tooltip sourcemap and NO_COLOR/FORCE_COLOR
notices as nonblocking diagnostics and the legacy-fixture warning as intentional
protection. No warnings or release policies were suppressed. The dependency-audit
CI result remains unknown; deployment, populated databases, multiworker WS,
historical backfill, automated suspension, full DM pagination, public ranks and
legacy backend activation remain outside scope. No push, merge or deployment
was performed. Scoped re-review remains pending the controller's verdict.

## Final review approval

The independent whole-branch review examined all 111 changed files through
`6fc77162`. Its two Important findings (blocked Connect and the district input
enum), Minor date-validation finding and obsolete probe-header comment were fixed
in `d041780b`. A separate scoped re-review read the full fix diff and marked all
four ADDRESSED, with no new breakage and no new out-of-scope defect. Earlier
pending-review statements above describe the historical validation sequence;
no code review remains pending.

The final full release gate passed on provisional `9d060966`; `d041780b` differs
only in this evidence document. The final review-record update also changes only
this document. The final code therefore retains 348 passing Python tests,
45 student-rank tests, 58 database tests plus 4 operator checks, 122 gateway/shield
tests and 63 browser tests, with zero required skips and reproducible generation.

Only existing nonblocking tooltip source-map and color-environment diagnostics
remain deferred; the legacy-fixture warning is an intentional deployment guard.
No functional finding is parked. The separate dependency-audit CI result remains
unknown and its existing policy still applies. Local verification is not evidence
of production deployment, populated-data migration, or multiworker operation.

All 16 planned tasks are complete. Branch `codex/backend-completion` remains local
for the user's integration choice; no push, merge or deployment was performed.

## Subsequent integration review follow-up (2026-10-10)

A later whole-branch review at `9385f402` reproduced three additional integration
gaps in tasks 4, 11 and 16. This dated follow-up supersedes the earlier claims
that no code review remained pending and every requirement was complete at that
point. Earlier approvals, tests and failed attempts remain historical evidence.
The three reported gaps are now fixed and verified locally; independent controller
review of this fix wave remains pending.

- The shared chat thread watches the newest message ID as well as count, so a
  latest-50 window scrolls after send or polling replaces its oldest message.
  Permanent browser cases keep the window at 50, check the oldest row disappears
  and require the entire newest bubble in the viewport. Existing empty/short
  history and 0/49/50-message coverage remain.
- Weekly chart columns share equal plotting heights and bottom baselines, with
  a fixed label area. Dates, counts, null dash, Untracked/Partial, current
  Week-to-date and accessible titles remain. Eight-week fixtures at 1440, 375
  and 320px check relative geometry, null/zero heights, hand-derived proportions,
  label containment and no overlap into the following mobile card. A native
  horizontal scroll region and small minimum width keep labels readable.
- The shared Python fixture uses documented Uvicorn auto WebSocket mode. Two
  tests collected by the default Python suite use the actual gateway, Python
  and disposable canonical PostgreSQL for room and DM sockets. They require
  anonymous/wrong-Origin and unauthorized DM/district-room rejection, two-peer
  bidirectional delivery and both messages in both accounts' REST histories.
  Socket waits are bounded. Direct Python socket tests and gateway malformed/
  duplicate-header checks remain; gateway validation was not weakened.
- The authorized release prerequisite patches the existing transitive
  `source-map-js@1` override to 1.2.2 for high advisory
  [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q).
  Only its override, version/integrity/snapshot and existing Tailwind/PostCSS
  lock edges changed. No dependency was added, and minimumReleaseAge, audit
  thresholds, freeze scope and release policies remain unchanged.

Commands ran in the isolated worktree with
`PATH=/Users/rinny/.nvm/versions/node/v24.21.0/bin:$PATH`: Node 24.21.0,
pnpm 10.33.0, uv 0.11.16, root `.venv` Python 3.12.13 and disposable PostgreSQL
16.13. `CLASSROOM_TEST_PYTHON` remained set by the gate, preventing required DB
checks from silently skipping. Full logs, browser traces, screenshots and the
detailed `task-1-report.md` are retained in the ignored workspace
`.superpowers/sdd/2026-10-10-backend-review-followups/`.

| Exact command (after the PATH assignment above) | Result and retained log |
| --- | --- |
| `pnpm exec playwright test e2e/classroom-flow.spec.ts --grep 'a new DM stays in view'` | RED exit 1, 2 failed: newest-bubble viewport ratio 0.02777777798473835 (`dm-red-clean.log`). GREEN exit 0, 2 passed in 5.6s (`dm-green.log`). |
| `pnpm exec playwright test e2e/classroom-flow.spec.ts --grep 'weekly bars share'` | Initial RED exit 1, 1 failed: plot-height mismatch 23px (`chart-red.log`). Initial GREEN exit 0, 1 passed in 3.0s (`chart-green.log`). Expanded eight-week RED exit 1, 3 failed label containment at 1440/375/320px (`chart-mobile-red.log`); final GREEN exit 0, 3 passed in 6.7s (`chart-mobile-green.log`). |
| `sh scripts/test-python.sh tests/test_backend_completion.py -k real_gateway_websockets -q` | RED exit 1, 2 failed/2 deselected in 1.86s: rejection checks passed, authorized upgrades returned 502 (`websocket-red.log`). GREEN exit 0, 2 passed/2 deselected in 2.28s (`websocket-green.log`). |
| `sh scripts/test-python.sh tests/test_backend_completion.py tests/test_chat_integration.py tests/test_chat_missions_1_6.py tests/test_dm_history.py -q` | Exit 0, 55 passed in 17.93s, zero skipped; source compilation included (`chat-green.log`). |
| `pnpm test:gateway` | Exit 0, 114 gateway plus 8 shield passed, zero skipped (`gateway-green.log`). |
| `pnpm build:release` | Exit 0 after the final chart/dependency patch; typechecks and both release bundles passed (`build-final-green.log`). |
| `pnpm exec playwright test e2e/classroom-flow.spec.ts` | Initial exit 0, 11 passed before mobile expansion (`classroom-green.log`); corrected fixture distribution exit 0, 13 passed in 38.9s (`classroom-final-green.log`). |
| `pnpm audit --prod --audit-level high --json` | Exit 0 before and after patch; all severities zero (`audit-production-before.json`, `audit-production-after.json`). |
| `pnpm audit --audit-level high --json` | Before patch exit 1, high 1/moderate 1 (`audit-complete-before.json`). After patch exit 0, high 0/critical 0/moderate 1 (`audit-complete-after.json`). |
| `pnpm verify:release` on clean `509fb925150a979eb21d920436ca772d74e52527` | Historical/provisional exit 0: Python 350 and browser 66 passed with all other gate stages (`verify-release.log`). Superseded by density/mobile and security follow-ups below. |
| `pnpm verify:release` on clean `8fc0796e77f1336efd0130ad49b1a54331236969` | Exit 1: preceding stages passed, browser 66 passed/2 failed at chart mobile login setup with 429 (`verify-release-final.log`); traces retained in `release-failed-rate-limit-browser-results/`. |
| `pnpm verify:release` on clean `e838899c0a412f6a01a1ab6cf6c015b65944fe7d` | **Exit 0**: runtime 8, freeze self-tests 8, Python 350 (63.70s), student ranks 45, gateway 114+8 shield, mockup 1, canonical DB 58 plus four operator checks, frontend unit 3, smoke 4 and browser 68 (1.8m). Zero required skips. Locked installation, source compilation, typechecks/builds, migration/post-merge checks, reproducible generation, 48 REST/2 WS contract agreement, 154 boundary checks and secret checks passed (`verify-release-corrected.log`). |

Mobile self-review initially found wrapped labels below the reserved area at
375px (Partial bottom 649, area bottom 605). Expanded tests reproduced the issue
at all three widths. The minimal overflow/minimum-width/nowrap correction keeps
the final Partial bottom at 604 within the region ending at 605; the card ends
at 626 and following card begins at 650, with document width 375. Final screenshots
and measurements are `chart-mobile-final-{left,right}.png` and
`chart-mobile-final.json/log`. Intermediate failed attempts are disclosed in the
task report; containment/visibility assertions were not relaxed.

Keyboard access was checked against the final compiled UI in bundled Chromium
at 375px (`chart-keyboard-check.cjs`, exit 0; log/JSON/screenshots retained).
From Run Analysis, one Tab focuses the native scroll region; horizontal arrow
keys reach the full current Week-to-date/Partial labels (scrollLeft 0 to 275).
Safari/Firefox and assistive-technology sessions were not exercised.

The second gate's 429 failures came from 12 mentor logins within the real
gateway's unchanged 10-per-account/60-second limit. Upstream fixture reset does
not reset the gateway limiter. The chart cases now use the existing mentee
account, distributing the file's logins as mentor 9/mentee 5. No limiter,
assertion, auth mock, wait or fixture-server policy was weakened. The standalone
classroom file and corrected complete gate both passed with this distribution.
An earlier overlapping browser invocation also collided on fixed fixture ports
and trace output; clean RED runs were repeated serially before implementation,
and the task report preserves the tooling error.

Code and tests remain identical to successful gate commit `e838899c`; subsequent
tracked edits update only this results record and the runbook's coverage sentence.
Generated browser output is retained in the ignored follow-up workspace. Existing
tooltip sourcemap/color notices remain nonblocking and the legacy-schema warning
remains an intentional safeguard. One moderate build-tool finding remains in
`postcss-selector-parser` via `@tailwindcss/typography` (read-only moderate audit
exit 1; `audit-moderate-context.json`); its patched major version was outside the
authorized high/critical patch. Both required local audits pass; separate CI
audit status is unknown. Independent review remains pending. No push, PR, merge,
deployment, populated-database operation or primary checkout change was performed.

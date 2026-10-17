# Account trust and administration — local verification record

Completed locally on 2026-10-17. Independent reviews have no open findings, and the unchanged full release pipeline exited0 on the final implementation below. The new features have not been deployed.

Product base: `f3972b1046a80b454c6a5e62c84cca9d625c54dd` (merged PR23). Final implementation: `b3344a836e99618981c4430c85f5b3996e15a964`. Local branch: `codex/account-trust-admin`; retained worktree: `/tmp/mentor-connect-account-trust`. Any later documentation-only commit does not change the tested implementation.

The approved scope was local account ownership, administrator boundaries, community safety and comment management, followed by additional independent review and regression. No remote deployment, database/grant operation, provider signup, actual email, credentials/settings change, push or PR was performed. Existing user changes and other worktrees were preserved. This is not deployment or real-mail readiness approval.

## Delivered behavior

- Email ownership uses expiring, single-use account/email-bound tokens, SHA-256 digests at rest, persisted resend/confirmation limits and serialized token consumption/replacement. Failed delivery preserves the previous delivered token. Production delivery defaults to disabled; an explicitly enabled development outbox is confined to local tests with protected directory/file modes. Links require explicit confirmation and are scrubbed before rendering, kept out of persistent storage and query/mutation caches, and cleared on account/document changes.
- Python checks current database ownership and separate administrator privilege; the gateway enforces fresh authority and strict request/response contracts. React guards operational pages, aliases and query navigation before mounting protected content. Student mentor discovery is `/mentors`; operational matching remains `/recommendations` for administrators.
- Existing block/report controls are available to verified members. Only administrators can read/moderate reports. Authorization failure discards report descriptions, notes, drafts and cached query/mutation state; late responses and account changes cannot restore another account's data. Status-only moderation preserves the stored note atomically; explicit null clears it and a supplied bounded string replaces it. Every moderation update records current actor/time.
- Authors can edit/delete their own visible comments. Deletion clears the stored body and returns a tombstone, preserves replies and ordering, and cannot be reversed by duplicate-create replay or later edit.
- Additive migration0006 resets legacy suffix-derived verification without deleting content or promoting administrators. Immutable migrations0001–0005 are unchanged. Canonical SQL, Drizzle, catalog and migration ledger agree. The ownership upgrade helper is deliberately restricted to disposable loopback rehearsal databases and requires explicit reset acknowledgement.

## Independent review and corrections

Different reviewers examined backend/schema, gateway/contracts and UI before a fresh whole-branch review. The whole-branch reviewer read the complete diff, generated contracts, migrations, tests and executable runtime entrypoints; a legacy, unused Python application was not mistaken for the deployed entrypoint. Reviewers inspected passing evidence rather than rerunning identical suites; suspected new gaps received focused reproductions.

| Review | Findings and correction | Final disposition |
| --- | --- | --- |
| Backend/schema (`9a20e7a0`) | No actionable finding. Ownership, current authority, privacy, tombstones and explicit upgrade were reviewed. | Spec and quality/security PASS. |
| Gateway/contracts (`fee7159e` → `82b07d63`) | Two P2 findings: UTF-16 length checks disagreed with Python code-point bounds; legacy report descriptions were rejected by a new read limit. Corrected code-point validation/generation and preserved legacy evidence. | Both addressed; scoped spec and quality/security PASS. |
| UI (`083d314b` → `293d7aac`) | Three P2 findings: report data/drafts survived read/write authorization denial; own-profile error exception also exposed cached peer profiles; an old pending confirmation cleared a newer fragment. Corrected disposal/reauthorization, self-only exception and version-bound token completion. | All three addressed; scoped spec and quality/security PASS. |
| Whole branch (`293d7aac` → `b3344a83`) | One P2 found through actual gateway/Python/PostgreSQL: omitting unchanged moderation note silently stored NULL. A single SQL UPDATE now distinguishes omitted/null/string, with documented contract and real DB/browser regressions. | Addressed; scoped spec and quality/security PASS. No new fix-induced finding. |

All six independent-review findings are resolved. There are no parked findings or remaining local implementation review blockers. No P0/P1 or executable authorization bypass was identified by these reviews; this is a bounded review conclusion, not a guarantee about untested environments.

## Role and privacy coverage

| Identity/state | Exercised behavior |
| --- | --- |
| Anonymous | Public district list/aggregate and health stay available; member/operational HTTP and chat sockets deny access; protected browser routes redirect without fetching private operational data. |
| Unverified account | Own account/settings and verification remain available; member queries, protected profiles, operational APIs and room/DM sockets deny access. |
| Verified mentor, mentee, both | Each role lacks operational menus/direct routes/GET/mutations, including dashboard aliases. Directory and ordinary student chat remain available; foreign rooms/DMs are denied. Student role never grants administrator privilege. |
| Verified administrator | Operational reads/actions and report review work; forged actor/admin/ownership fields are rejected. Revocation is rechecked on subsequent authoritative requests. |
| Revocation/account switch | Cached reports, notes, drafts and late responses are disposed; peer-profile identity errors fail closed while own settings drafts survive retryable failures. Ownership/membership/block checks are re-evaluated on socket send/broadcast. |

Actual local HTTPS tests use independent browser contexts with real gateway, Python and disposable PostgreSQL. They cover ownership confirmation, protected outbox, token secrecy, blocking/unblocking, request/comment/reply/edit/delete, application then owner acceptance, connections, bidirectional room/DM chat, sender/origin/membership denials, reconnect recovery/dedup, refresh/relogin and service-restart persistence. The new report journey saves a valid note in the real editor, reloads, sends exactly a status-only PATCH, checks the real database/audit and reloads again. It fabricates no moderation responses.

## Final validation

Runtime: Node24.21.0, Python3.12.13, PostgreSQL16, pnpm10.33.0 and frozen uv/pnpm dependencies. Final command at the implementation SHA above:

```sh
export PATH=/Users/rinny/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/opt/postgresql@16/bin:$PATH
export PYTHON_BIN=$PWD/.venv/bin/python
export UV_PROJECT_ENVIRONMENT=$PWD/.venv
sh scripts/verify-release.sh
```

Final process exit: **0**. All final test suites below passed with no failed, cancelled or skipped cases; Playwright had no retries.

| Check | Final result |
| --- | --- |
| Full Python, including real PostgreSQL/gateway/HTTPS journeys | **422 passed**,154.35s |
| Separate `MENTOR_RANKS_MODULE=mentor_ranks` suite | **45 passed**,0.79s |
| Gateway and shield | **137 +8 passed** |
| Database/schema/operator suites | **69 passed** (26+3+9+14+7+10); schema0006; constraint differences0 |
| UI unit | **11 passed** |
| Playwright | **104 passed**,3.1min |
| Runtime/freeze self-tests, mockup, smoke | **8 +8 +1 +4 passed** |
| Migration entrypoint and post-merge tests | Passed |
| Workspace typecheck and release build | Passed |
| Code generation and checked-in generated output | Passed; regeneration produced no diff |
| Contract inventory | Python/OpenAPI/gateway **62 REST**, **2 WS**, all authorities/declarations/errors/headers matched |
| API boundary verifier | **169 checks passed** |
| Tracked-file secret scan; secret-history wrapper/workflow-policy self-tests | Passed; the tracked scan does not claim a scan of historical Git contents |
| Immutable migrations0001–0005 and whitespace | No immutable migration changes; diff check passed |

The final full pipeline was run alone against frozen committed source, with no source/test/index edits or overlapping browser runner. The separate mentor-rank run is an alternate module check and overlaps the main Python suite; totals should not be added as unique coverage. Actual HTTPS/browser/database journeys are included in the Python suite; the separate Playwright suite also contains deterministic fixtures. Reproducible code generation was additionally checked by matching all103 generated-file hashes.

Historical red failures and setup errors are distinct from final results: missing behavior and six review defects were reproduced before correction; earlier fixture/readiness metadata mismatches were corrected; one earlier browser run lost a trace artifact because two runners shared an output directory, then isolated/sequential runs passed. The final note regression first showed one failing omitted-note case with two passing clear/replace controls, plus a real browser persisted-note failure. Its focused green run passed33 tests in57.18s. Initial new-browser fixture attempts failed because an API login omitted Origin and later used the wrong route; those were corrected without weakening access checks. The known freeze self-test checks working HEAD/untracked Python, so validated Python changes were committed before the final pipeline and completed diagnostic source was preserved as text. Freeze policy was not relaxed.

Nonfatal test-server output included Vite WebSocket-proxy EPIPE and NO_COLOR/FORCE_COLOR warnings; no assertion failed and the final process exited0. These local development-server logs are not a production/container validation.

No configured lint command exists in the root/gateway/frontend packages or Python tooling, so lint is **not configured**, not passed. Historical teaching-branch Python-freeze checks are scoped to `codex/learning-tasks-21-24`; the unchanged release script correctly excludes that policy on this branch while still running the freeze tool's eight self-tests. At this record's original completion, container mode was **not run**. The subsequent [local container follow-up](2026-10-17-account-trust-container.md) records both image builds, a passing constrained ARM64 journey, an unexplained earlier ARM64 504 and a failed emulated AMD64 post-restart UI assertion. The later [socket responsiveness diagnosis](2026-10-17-socket-responsiveness.md) records the proven event-loop fix, fresh 428-Python/104-browser release pass, new container evidence and remaining qualified AMD64 recovery result. Actual Render behavior, mail/provider delivery, remote migration/grants and live deployment verification remain **unverified**. Mobile work was excluded; existing responsive regression tests remain in the inherited suite.

## Recorded implementation decisions

These are the complete two Ruling entries from the implementation ledger, not unresolved findings:

> Ruling: Preserve existing peer profile projection (id/name/subjects/createdAt); seven-field mentor directory projection applies only to /mentors — limits privacy changes and avoids breaking MemberProfile — if wrong, richer peer profile details would need a separate product decision.

> Ruling: Existing journey upgrade must not silently reset email ownership via new schema tail. Add an explicit account-trust upgrade acknowledgement/path and keep legacy journey target behavior — prevents old runbooks from causing unexpected account lockout — costs additional operator tooling/tests.

## Remaining operational prerequisites

Follow [the rollout runbook](../../ACCOUNT_TRUST_RUNBOOK.md). A subsequent authorization must identify the target environment, maintenance window and backup/restore plan; approve a separately reviewed remote0006 migration and restricted grants; select/implement/test the mail provider; and name the verified account to receive an audited administrator grant. Provider signup, paid plans and persistent credentials require separate authorization. Migration0006 makes old registration writers incompatible, so stop them before applying it and coordinate the whole release. The local upgrade helper refuses remote targets and must not have its safeguards relaxed for deployment.

Push/PR and deployment remain separate future actions. No operational administrator was provisioned, no existing remote database was changed, and this branch's new ownership flow is not available at the existing live address.

Preservation checks: the original checkout remains at `febb535a749b467251ae47493952a772847f6aca` with the same nine untracked `.DS_Store` entries; the earlier Render/Neon worktree retains its two pre-existing modified runbook/progress files; the earlier E2E fixes worktree remains clean. No reset, merge, push or cleanup of those worktrees occurred. This branch is retained for review. Temporary SDD diagnostics are removed only after this durable record is saved; no raw token-bearing artifacts are committed.

Reproducible supporting code: [gateway/database moderation regression](../../../tests/test_gateway_account_trust.py), [actual HTTPS moderation journey](../../../tests/support/report-moderation-journey.mjs), [role-wise real sockets](../../../tests/test_account_trust_role_sockets.py), [browser privacy regression](../../../e2e/account-trust-review.spec.ts), [release verification script](../../../scripts/verify-release.sh), [design](../specs/2026-10-17-account-trust-admin-design.md) and [completed plan](../plans/2026-10-17-account-trust-admin.md).

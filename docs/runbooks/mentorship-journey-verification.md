# Mentorship journey local verification — 2026-10-17

## Scope and retained work

Implementation branch: `codex/e2e-journey-fixes`, worktree `/tmp/mentor-connect-e2e-fixes`, based on remote main `febb535a749b467251ae47493952a772847f6aca`.

- `c3496e5f`: room/DM operation keys, committed-insert broadcast and composer retry identity.
- `839682e8`: additive application/comment storage, consent transitions, contacts/activity, API contracts and upgrade tests.
- `b184cce2`: discussion/application screens, named DM navigation, connections/activity and browser integration.

The original main checkout's untracked `.DS_Store` files and the earlier deployment worktree's two modified runbook/progress documents were retained. No remote push, PR, Neon write, Render change or credential change was performed in this phase. All database mutation tests use disposable local PostgreSQL.

## Verification evidence

The `sh scripts/verify-release.sh` run on `b184cce2` passed every pre-browser stage. Its browser stage ended with 74 passed and one login-input timeout during the Mac disconnection (3.0 hours elapsed). On October 17, the full browser stage was rerun against the unchanged commit: **75 passed in 2.3 minutes**. All release checks therefore have passing evidence; this is a resumed gate, not a claim that the interrupted script exited successfully.

| Check | Observed result |
| --- | --- |
| Locked pnpm/uv setup, TypeScript checks, gateway + SPA production build | Passed |
| Python suite, including real local HTTPS + PostgreSQL + two browser contexts | 380 passed |
| Alternate mentor-rank implementation | 45 passed |
| Gateway + maintenance shield | 120 + 8 passed |
| DB tools, Drizzle, real migration/catalog, bootstrap, restore | 26 + 3 + 8 + 14 + 7 passed; four operator commands passed |
| UI unit tests | 9 passed |
| OpenAPI generation, public route contract, API boundary | No generated drift; 55/55/55 route alignment; 169 boundary checks passed |
| Secret scan and security workflow tests | Passed; no credentials printed |
| Classroom smoke harness | 4 passed |
| Browser fixtures, including named-DM recipient-switch draft isolation | 75 passed on the resumed full browser run |

Initial failures were recorded rather than suppressed: obsolete immediate-match fixtures/version counts were updated for the new contracts; two browser fixture failures were corrected (shared test login exceeded the real gateway rate limit, and an undefined fixture user variable). Production rate limits remain unchanged. Tagged login aliases are supported only by the isolated browser fixture server.

The real HTTPS test uses the built gateway/SPA, authoritative FastAPI and a disposable PostgreSQL database. It covers UI-created requests/comments/replies, application pending then owner acceptance, named DM, synchronous duplicate submit, process restart persistence and the `/connections` deep link. The existing harness additionally covers two-way room/DM WebSockets, recovery of a 51-message reconnect gap, membership/block/Origin/sender guards, refresh and relogin. Fixture browser tests are reported separately from this integration test.

The repository has no separate root lint script; its TypeScript/build and release checks were used. Public two-account UI verification of this branch has not run. The current deployed service was not modified. Mac connection was restored on October 17 and the existing Chrome public-site session was readable. Safari's app-state query timed out; the in-app browser alternative returned unavailable. A second user-browser session therefore remains unconfirmed. This does not affect the passing two-context local Playwright tests. Public verification requires the separately approved migration/deployment and two available browser sessions.

## Decisions and limits

1. The message operation UUID remains optional for legacy clients. New clients send it; legacy no-key calls retain their prior behavior. Cost: retries from old clients may still duplicate a message. Drafts/operation keys are not persisted across closing/reloading a composer.
2. Contacts use descending user ID cursors; activity uses descending request ID cursors, with 50-row bounds. Cost: they show a stable ID order, not a recently-updated order; each contact shows its latest matched request. Cancelled application rows are reused on reapplication, so the record represents the current relationship rather than a complete attempt audit.

## Final review

One fresh independent reviewer (GPT-6 Astra) inspected `febb535a749b467251ae47493952a772847f6aca..b184cce2fed25c341d0bbc19839994d4164bc6d6`, the supporting source/tests and corrected upgrade runbook. Verdict: **ready to merge locally; no Critical, Important or required Minor corrections identified**. No second review was commissioned. Remote release was not included in this verdict.

The reviewer confirmed serialized acceptance/event writes, committed-insert-only broadcast, retry permission checks, additive legacy preservation, account/thread-scoped UI state and aligned gateway/API contracts. The executor accepted the findings; no product fix pass was needed. The migration CLI documentation was corrected to explain that it is dry-run only and a reviewed operator launcher is still required.

Every behavior the reviewer declined to judge was ruled on explicitly:

| Behavior | Executor ruling | Cost/limit |
| --- | --- | --- |
| Remote migration execution and duration | Outside the authorized local phase; require approved launcher, disposable rehearsal, maintenance window and deadlines before release | Remote timing and successful execution remain unproven |
| Public deployment behavior | Keep it pending until this release is approved and deployed | Local success does not establish provider/runtime success |
| No-key/legacy WS retry deduplication | Retain approved compatibility; new UI uses REST UUID keys | Old callers may duplicate retries |
| Retry identity after composer closure/reload | Preserve documented in-memory draft lifetime | Retyping after closure can create a separate operation |
| Comment editing/deletion and deeper nesting | Keep approved plain-text, one-level discussion scope | Users cannot edit/remove comments or create deeper threads |
| Final rejection and row reuse | Retain approved final rejection and cancelled-row reuse | No retry after rejection or full attempt audit history |
| School-email ownership verification | Keep the existing test-service limitation explicit | A suffix check does not prove account ownership; unsuitable for real student data |
| Verification report completion | Complete this committed report before handoff | Stale evidence could otherwise overstate readiness |

Deferred nonblocking test suggestions: delayed DM-start responses during account changes, and replies whose parent lies outside the first comment page. Current code was reviewed for these cases, but dedicated browser regressions were not added in this phase.

Evidence files retained outside Git: `/tmp/mentor-e2e-fixes-release-interrupted-20261016.log` (complete interrupted pipeline), `/tmp/mentor-e2e-fixes-browser-final-20261017.log` (75-test passing rerun), and `/tmp/mentor-e2e-fixes-real-https.log` (earlier focused real-backend HTTPS integration). No credentials are included in this report.

## Remaining approval boundary

See [the upgrade runbook](mentorship-journey-upgrade.md) for ordered migrations `0004` and `0005`, minimum application-role grants, compatibility and rollback limits. Push/PR, the new test Neon schema/grants and Render redeployment remain separate approval steps. Completion of local checks is not completion of deployment.

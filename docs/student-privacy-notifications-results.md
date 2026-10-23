# Student privacy and notifications: local release evidence

Date: 2026-10-23. Baseline: `78b65d974432f73d5abc296b19811c10c9802c3c`.
Prepared in the isolated local clone `/Users/rinny/Documents/Codex/2026-10-23/task/mentor-connect`, branch `codex/student-privacy-notifications`. The original `codex/demo-admin-991` checkout remains unchanged.
Verified application/test commit: `a0eb6519ae12e6d0c652dfe781661b3abd0354b2`; subsequent changes only finalize this report and the plan checklist.

## Delivered behavior

| Requirement | Implementation and evidence |
| --- | --- |
| Request title limit | Server, form and generated validation share Unicode code-point counting, including spaces. Boundary tests cover 59/60/61, Korean, astral emoji, combining characters and invalid surrogates. Existing stored titles are preserved. |
| Signup password | New accounts require 12+ code points, one ASCII uppercase letter and one ASCII punctuation character, with the existing bcrypt 72-byte ceiling. Existing account login is unchanged. |
| Question and matching notifications | New questions retain the existing five eligible mentor recipients plus author summary. Audience filtering applies before selection. Acceptance notifies each participant once per application. Reads acknowledge only observed IDs; an explicit mark-all action handles older entries. Replay, late commits, read state and rematches have regression coverage. |
| DM unread badge | The existing bottom-right widget and conversation list show exact server unread counts. Reading acknowledges only visible incoming message IDs. Tests cover reconnect, duplicate events, self messages, hidden tabs, multiple tabs, polling, logout cancellation, batches and counts above 99. |
| Gender and birth date | New registrations require female/male and a real nonfuture ISO date. Values are stored in nullable columns and omitted from public/auth/profile responses and validation errors. Legacy users remain null. The form does not claim age or enrollment verification. |
| Request audience | New requests select female/male/both. A shared server access rule covers list, detail, discussion, applications, matching, notifications, activity, reports and related counts. Unknown gender fails closed. Authors retain access to their own posts, including an audience different from their gender; existing administrators retain moderation access and remain blocked from student functions. Old posts become both. |

Primary source groups: `Python/request_access.py`, `Python/routers/{auth,requests,request_interactions,notifications,chat}.py`, matching/ranking helpers; `artifacts/peerbridge/src/pages/{Register,NewRequest,Notifications,RequestDetail}.tsx`, `ChatWidget.tsx` and chat/unread helpers; gateway policies, OpenAPI and generated clients; migration/schema/catalog assets. Dedicated Python, gateway, schema, unit and browser regressions accompany these changes. Existing signup fixtures were updated with synthetic values only.

## Verification

Runtime: Node 24.21.0, pnpm 10.33.0, Python 3.12.13; disposable loopback PostgreSQL and synthetic browser fixtures. The Python suite includes a real local HTTPS signup journey through the built SPA/gateway and Python API. No production test accounts, messages or student information were created.

- Full release gate: `pnpm verify:release` passed with exit code 0. Evidence: `/tmp/mentor-verify-release-final.log`.
- Passed stages: typecheck and release build; 967 Python tests plus 45 alternate-ranking tests; 175 gateway tests plus 8 shield tests; the full database suite; 17 frontend unit tests; migration entrypoint/post-merge checks; reproducible API code generation; 67 REST/2 WebSocket contract consistency and 179 API boundary checks; current tracked-file secret scan and secret-workflow tests; all 174 browser tests (zero failures).
- Separate production-bundle verification passed for 29 files and 26 manifest entries.
- Separate full database suite: 148 Node tests and 6 Python tests passed, zero failures or skips (`/tmp/mentor-db-schema-full.log`).
- Separate historical restore diagnostics: 12 tests passed, zero failures or skips (`/tmp/mentor-historical-diagnostics.log`).
- The 0008→0009 migration test verifies old-column preservation, null legacy demographics, both legacy audiences, unchanged existing ACLs, rollback/replay, synthetic narrow-permission signup and durable notification deduplication. Migration files 0001–0008 are unchanged.

An independent whole-diff review found two read races: sequence-ID watermarks could acknowledge unseen late-committing DM messages or notifications. Both now use exact observed IDs, with failing-before/passing-after regression tests. Review follow-up found no further findings. History refresh was also corrected to retain a fresh latest-message window so older late commits can become visible without a reload.

The first full browser run exposed five obsolete fixture expectations: four lacked the newly required unread-count response and one expected the superseded 200-byte title rule. Those fixtures were corrected without relaxing unknown-request assertions or changing application behavior; all five then passed. Historical recovery tests use a verified temporary 0008 fixture rather than changing production recovery guards.

## Rollout scope and remaining limits

No remote push, deployment, production migration, authentication activation, production permission changes, account deletion or password reset was performed.

See [the migration handoff](runbooks/student-privacy-schema-upgrade.md) for the precise separately authorized rollout: rehearse a disposable 0008 backup/restore and migration; apply additive migration 0009 using the existing audited process; review only `INSERT (gender, date_of_birth)` for the actual application role; release the compatible server and clients together. The migration itself grants nothing. The older exact-permission grant policy requires coordinated review before reuse. An old server cannot safely serve restricted posts after rollback; preserve new data and use a reviewed compatible recovery plan.

Production behavior, operator lock time, real email delivery and production grants remain unverified by design. Existing admin account 991 and district/subject/tag/time data were not modified in production.

Reference-image limitation: exact Library ID `libfile_c9166695043881918ba7e8e24af15256` resolved to `image(1).png`, but the official materialization helper failed to download it to `/Users/rinny/Documents/Codex/2026-10-23/task/reference/dm-reference.png`. No local image file was created, so its pixels were not inspected and visual parity is unverified. The badge uses the existing bottom-right widget. This was a failed download, not an approval denial or a pending production action.

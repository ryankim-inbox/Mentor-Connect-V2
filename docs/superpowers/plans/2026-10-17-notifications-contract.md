# Notifications integration plan

The user independently merged PRs #27 and #26 into main at `309f3759`. The parent then explicitly requested diagnosis and repair of CI's 62-versus-64 REST-contract failure. The original main checkout and its local files remain untouched; its changes are integrated only into the existing isolated PR branch.

## Findings and decisions

- The additional operations are GET `/api/notifications` and POST `/api/notifications/read`. Existing public payload projection and OpenAPI have neither operation; changing only a count would leave a real gateway failure.
- The new runtime creates tables/indexes on member requests, which conflicts with the approved non-DDL application role. Preserve the feature through explicit immutable migration 0007 and a separate local-only operator rehearsal; no new live migration is authorized by this implementation.
- Notification recipients must satisfy the same fresh member policy as other member surfaces. Synthetic, unverified third-party and blocked candidates must not receive notifications. Creating a suggestion never accepts an application, matches a request, opens a DM or records a successful-match event.
- Frontend notification data must be isolated by current account ID and cancelled during account changes.

## Implementation and verification

- [x] Add both exact operations, response/status validation, generated clients and contract fixtures; test malformed payloads and unauthorized access.
- [x] Remove runtime DDL, add self-only member routes and candidate policy regressions with a narrow runtime role.
- [x] Add immutable 0007 schema/catalog and narrow notification grants; prove existing data/ownership/grants survive and failed transactions roll back. Preserve explicit historical 0005 and 0006 backup compatibility.
- [ ] Run fresh full local release and all CI checks on the final integrated branch. Do not merge into main or perform live DB/provider/deployment changes.

The earlier 813899f8 release run was stopped after 504 passed and six failures from an outdated socket-test monkeypatch (`require_verified_user` renamed to `require_member_user`). The fixture is corrected; it is not a successful full run. Runtime/source changes from main require a fresh complete run.

Focused validation: all 64 operation identities match across Python, OpenAPI and the gateway; gateway tests passed 160 plus 8 shield checks. Browser coverage passed 48 account/member/notification cases, with all five notification cases repeated after the final build. Runtime regression checks passed 55 cases, and all five database-backed notification tests passed with the real gateway path included. The new tests first reproduced runtime DDL, stale member policy and recipient eligibility failures. Independent review found no actionable issue in the integrated notification changes; its database checks without a DSN were explicitly skipped and do not substitute for the operator's disposable database suite.

The complete database suite passed 106 tests with zero failures/skips, plus four disposable operator-command checks. This includes 12 notification-upgrade checks, 13 synthetic-seed checks, native 0006 snapshot restoration and the existing 0005 recovery. The historical 0003→0005 helper initially tried to lock the newer notifications table; its preservation set now comes from verified frozen 0005 assets, while its target migrations and grants remain unchanged. Immutable migrations 0001–0006 and frozen 0005 assets are unchanged. Current metadata is 0007 with 19 tables, 131 columns, 80 constraints and 60 indexes.

The first integrated full run passed 670 Python tests, 45 separate rank tests, all gateway/database/unit/contract/security checks, then failed 12 of 119 browser cases because the separate strict learning-surface fixture omitted GET `/api/notifications`. That fixture now declares the exact empty-inbox response and checks notification navigation; its unknown-request rejection remains unchanged. All 15 focused learning-surface cases passed after the fixture fix. A complete rerun of the final revision is required before claiming the release gate is green.

During verification, the user externally merged PR25 as `e877c9dd`. The completed PR is not edited or reused. New work remains on a separate local branch; publishing a new draft PR and its free CI is awaiting the requested target approval. No main merge or live operation is implied.

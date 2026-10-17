# Account Trust and Admin Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add verified email ownership, enforce administrator boundaries, and deliver existing community-safety controls and own-comment management.
**Architecture:** Python remains authoritative for identity and permissions. Gateway/OpenAPI publish a bounded contract; React renders verified student and admin surfaces separately. Additive schema 0006 provides persisted ownership tokens, privileges, moderation state and comment tombstones.
**Tech Stack:** Python 3.12/FastAPI/PostgreSQL, Node24/TypeScript gateway, React/Vite, pytest and Playwright.
**Spec:** docs/superpowers/specs/2026-10-17-account-trust-admin-design.md

## Global Constraints
- Local worktree only. No deployment, remote DB changes, push/PR, real email, provider signup, paid resources, or new credentials.
- Preserve user work and immutable migrations 0001–0005. Exclude mobile work.
- Keep mentor/mentee/both as student roles and `isAdmin` as a separate privilege. Never grant from client input.
- Tokens: 32 random bytes, SHA-256 at rest, 30-minute expiry, one use, last-delivered-token wins, resend 60 seconds and five/hour/account.
- Operational analytics/status/matching/scheduling/reports are administrator-only at API and UI; preserve student mentor discovery and applications/acceptance.
- Report contents admin-only. Own-comment deletion preserves replies and removes deleted text from all responses/replays.
- Logs and ordinary responses must never contain verification tokens or credentials.

## Review Focus
1. Legacy users falsely marked verified: task 1 upgrade proves ownership reset without content loss.
2. Revoked privileges with an existing session/socket: task 1 reloads database state and tests denial.
3. Resend or concurrent confirmation races: task 1 tests lock/atomic consume and failed delivery.
4. Direct frontend/admin URLs and gateway proxies: tasks 2/3 test both role distinctions and direct access.
5. Deleted parent replay or blocked peer: task 1 tests tombstone responses and preserved child content, task 3 browser renders it.

### Task 1: Authoritative backend and schema
**Files:** Python/security.py (new), Python/email_delivery.py (new), Python/routers/auth.py, users.py, chat.py, reports.py, request_interactions.py; Python/routers/mentors.py (new); Python/main.py; Python/api/routers/*; database/migrations/0006_account_trust.sql and ledger; database/schema/*; lib/db/src/schema/*; tests/test_account_trust.py (new), tests/test_comment_management.py (new), tests/test_admin_access.py (new), tests/fixtures/chat-canonical.sql and impacted tests/fixtures.
**Interfaces produced:** User includes `isVerified:boolean`, `isAdmin:boolean`; `POST /api/auth/verification/request` (session, no body, 202 sent or explicit disabled/delivery failure), `POST /api/auth/verification/confirm {token:string}` (session, 200 User); GET `/api/mentors?limit=&beforeId=` -> array of `{id,name,role,subjects,districtId,districtName,bio}`; GET `/api/admin/reports?status=&limit=&beforeId=` -> array of reports including reporter/reported names, reason/description/status/note/reviewedBy/reviewedAt/createdAt; PATCH `/api/admin/reports/{id} {status, note?}` -> same report. PATCH `/api/requests/{id}/comments/{commentId} {body}` and DELETE same -> comment with `updatedAt`, `deletedAt` nullable (tombstone body empty). `require_user`, `require_verified_user`, `require_admin` dependencies resolve current DB user.
- [x] Write failing actual DB/HTTP tests for token request/expiry/replay, admin matrix, role spoof, private profiles, comment ownership/tombstones and mentor visibility; run to confirm behavior failures.
- [x] Implement migration and backend. Update only synthetic local fixtures to verified timestamps; add explicit admin fixtures where operational tests need them. Do not weaken denial tests. New mail settings use EMAIL_DELIVERY_MODE=disabled|development-file, EMAIL_DEV_OUTBOX_DIR, APP_ORIGIN.
- [x] Regenerate canonical/schema catalog/manifest/Drizzle and test migration0005->0006 with seeded user/content retention.
- [x] Run targeted tests and full Python suite (record any gateway/UI integration failures awaiting subsequent tasks); commit task files locally and write report with exact API/error contracts and verification evidence.

### Task 2: Gateway and generated API contract
**Files:** artifacts/api-gateway/src/route-policy.ts, gateway.ts and tests; lib/api-spec/openapi.yaml and generated clients/zod; scripts/test-api-contract.mjs, scripts/verify-api-boundary.mjs and related contract expectations.
**Consumes:** Task1 endpoints/User/Comment/Report models above, definitive backend report.
**Produces:** Gateway allows new paths and bounded fields/query values; operational routes require verified admin in gateway AND backend; member routes require verified user; own auth/profile remains available unverified. Existing origin protections/rate limiting preserved. Public member profile still excludes email/verification/admin flags.
- [x] Add failing gateway tests for new routes, role matrix, forged privilege fields, unverified membership and throttling; run red.
- [x] Update route policy, session verifier and schemas; generate clients. Keep read-only public health/list/aggregate endpoints as spec. Reject unknown fields on sensitive request bodies, including privilege/author claims.
- [x] Run gateway tests/shield/boundary/API contract/codegen and typecheck; commit locally, report exact evidence and any dependent UI failures.

### Task 3: Verified-member and administrator UI
**Files:** artifacts/peerbridge/src/App.tsx, components/Navbar.tsx, auth/route guards, lib/auth-context.tsx, pages/Register.tsx/Login.tsx/Settings.tsx/MemberProfile.tsx/AdminReports.tsx/Dashboard.tsx/Recommendations.tsx/RequestDetail.tsx; new pages/VerifyEmail.tsx, Mentors.tsx and reusable member safety controls; unit/e2e fixtures and tests.
**Consumes:** Generated API models/endpoints from tasks1/2. Read their reports for final contracts.
**Produces:** `/verify-email` authenticated ownership flow (fragment scrubbed immediately, explicit confirm; no token in logs/cache/history), pending verification notice/route guard; `/mentors` student safe directory; existing `/recommendations` operational admin page. `RequireAdmin` guards all operational routes including dashboard practice aliases. Hide privileged menu items and nested dashboard diagnostics from students. Profile report/block and settings unblock; admin report queue status actions; own comment edit/delete with tombstones/replies.
- [x] Add failing browser tests for anonymous/unverified/student roles/admin navigation/direct paths, confirmation, report controls/privacy, comment management; run red.
- [x] Implement accessible controls, loading/error states, no automatic uncertain mutation retries. Refetch identity after verification, clear sensitive cached results on logout/account changes, avoid fetching admin data before authorization.
- [x] Update synthetic fixtures with explicit isVerified/isAdmin and revise old operational expectations for students; preserve student journey tests. Run UI unit/Playwright/typecheck/build and full release validation; report any errors clearly.
- [x] Commit locally and write operations runbook for eventual provider selection, migration and deliberate administrator grant, without performing them.

### Task 4: Independent whole-branch review and final validation
**Files:** review report and verification record in docs/superpowers; corrections as findings require.
- [x] Give fresh reviewer design, complete diff, task evidence and known limitations; require spec and quality verdicts including authorization matrix.
- [x] Resolve findings with regression tests, scoped re-review, then run appropriate full local release checks.
- [x] Record commits, tests, failures/unrun checks, local artifacts and exact later operational approvals required. Do not push/deploy. Final Korean report distinguishes local completion from operational availability.

Completed locally at implementation `b3344a836e99618981c4430c85f5b3996e15a964`; independent review findings resolved and full release validation passed. See [verification and review record](../reviews/2026-10-17-account-trust-admin.md). No operational rollout was performed.

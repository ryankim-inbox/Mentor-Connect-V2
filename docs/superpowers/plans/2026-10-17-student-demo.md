# Student Demo Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement task-by-task, with TDD and one fresh whole-branch review.

**Goal:** Deliver the six authorized student-demo requirements on a separate draft PR.
**Architecture:** Extend existing FastAPI authority and React/gateway contracts. Reuse matching, notification and ranking components with an additive schema migration.
**Tech Stack:** Python3.12/FastAPI, PostgreSQL18, Node24/TypeScript, React/Vite, pytest/Playwright.
**Spec:** `docs/superpowers/specs/2026-10-17-student-demo-design.md`

## Global Constraints

- Base f9fa0fc341d46c0482a4d42b02d59d34e913f4c0; branch codex/student-demo-boundaries.
- No changes to /tmp/mentor-connect-account-trust or pinned private operator.
- No remote DB/env/deploy changes, secrets, paid resources or main merge.
- Reuse existing API patterns; generate OpenAPI clients after contract changes.
- Preserve migration0001–0007 and label synthetic data honestly.

## Review Focus

- Already-signed administrator/student sessions cannot retain old authority in WS or UI.
- Concurrent reports and request replays must not create duplicate rows or alerts.
- Non-member, administrator, synthetic and blocked candidates cannot take top5 slots.
- Rank cannot be farmed by repeated messages or the same consent partner.
- Deleted posts retain moderation context and never leave an active notification link.

### Task1: Authority and student/admin navigation

Files: `Python/security.py`, `member_access.py`, affected routers, gateway authority,
`RequireAuth.tsx`, `Navbar.tsx`, chat and writing controls; real backend/gateway and browser tests.
Produces: `has_student_access(user)`, `require_student_user(request)`; existing admin
and member-read contracts preserved. No client-supplied privilege grants.

- [x] Write actual request/WS tests for admin denial and student aggregate denial.
- [x] Observe expected403 failures on baseline; implement reusable student gate.
- [x] Cover existing socket promotion and retained admin moderation abilities.
- [x] Add UI route/control tests, run role/auth/gateway suites and commit.

### Task2: Contextual reports and request idempotency storage

Files: additive `database/migrations/0008_student_demo.sql`, schema/catalog/manifest,
Drizzle models, report/request routers, API spec and generated clients, report modal/admin view.
Produces: report request reference/type/title; request UUID/payload hash; safe migration.

- [x] Add failing real-DB tests for missing/self/blocked/spoofed and duplicate reports.
- [x] Add request same-UUID replay409-content-conflict and identical-content coalescing tests.
- [x] Implement transactional target locks and additive schema; generate frozen artifacts.
- [x] Verify schema7→8 preserves rows and repeat/rollback safety on disposable DB.
- [x] Verify profile/post report UI and admin context; run related suites and commit.

### Task3: Common matching and inbox behavior

Files: `Python/find_matches.py`, `auto_match.py`, notification router/tests,
request creation/UI idempotency, existing inbox and bell component/browser tests.
Consumes: Task1 student eligibility; Task2 stable request identity.
Produces: `rank_candidates(student, mentors, question, limit=5)` deterministic pure scoring.

- [x] Test top5 after eligibility filters, ties, fewer5, no candidates and blocked/admin/synthetic cases.
- [x] Test committed-only delivery, replay uniqueness, deleted/closed request handling and inbox sort/read ownership.
- [x] Share scoring with find_matches; add inbox bell and bounded link behavior.
- [x] Run matching/notification/contract/browser suites and commit.

### Task4: Activity badges and complete acceptance

Files: production ranking adapter/router, gateway/API contract, badge component/profile views,
rank and browser tests, demo/rank/runbook documentation.
Consumes: Task1 eligibility. Produces: member profile activity badge calculated from accepted distinct peers.

- [x] Test all9 minima1/3/5/10/20/35/50/75/100, zero, ties, excluded accounts and repeated activity.
- [x] Implement production adapter using mentor_ranks sort/rank helpers; preserve lesson modules/contracts.
- [x] Test own/member profiles and rank error/unavailable states without hardcoded user counts.
- [x] Run two independent browser contexts for room/DM/reconnect and all new UI/authority tests.
- [x] Run complete release verification and focused migration checks; report failures/skips explicitly.
- [x] Obtain one fresh whole-branch review; fix actionable findings with RED→GREEN tests.
- [ ] Push only the new branch, create/attach draft PR, inspect exact-SHA CI; no main merge.

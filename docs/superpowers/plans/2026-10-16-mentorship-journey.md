# Mentorship Journey Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the new-account mentorship journey and make chat retries safe.

**Architecture:** Add PostgreSQL operation keys and request interaction tables, keep FastAPI authoritative, and expose consent/contacts/comments through existing React and gateway boundaries. Preserve all existing matches and messages.

**Tech Stack:** Node 24, TypeScript/React, Python 3.12/FastAPI, PostgreSQL, pytest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-mentorship-journey-design.md`

## Global Constraints

- No remote push/PR, Neon schema/role changes, Render deployment, paid feature, credentials change or Mac lock bypass.
- Work only in `/tmp/mentor-connect-e2e-fixes`, branch `codex/e2e-journey-fixes`, based on remote main `febb535a749b467251ae47493952a772847f6aca`.
- Preserve existing matches/messages and the original and deployment worktrees.
- Only disposable local databases may be mutated. Never read or print deployment secrets.

## Review Focus

- Two clients accept different applications concurrently: only one match and event.
- A blocked or former member retries an old operation: permission checks must still run.
- Lost response followed by same/different body retry: same row or explicit conflict, never silent overwrite.
- Legacy matches and no-key messages survive schema upgrade and remain reachable.
- Reply pagination, request reopening and account switching must not leak or strand another user's state.

### Task 1: Retry-safe room and DM sends

**Files:** `Python/routers/chat.py`, new `database/migrations/0004_chat_operation_keys.sql`, schema snapshots/Drizzle, `ChatWidget.tsx`, `chat-api.ts`, tests.

**Interfaces:** `SendMessageBody.clientMessageId?: UUID`; persisted uniqueness `(sender_id, room_id/conversation_id, client_message_id)`; same key/body returns same id, changed body 409. Composer sends `{body, clientMessageId}`.

- [ ] Add real PostgreSQL tests for sequential/concurrent replay, scope isolation, conflicts, permission rechecks and committed broadcast. Run RED against current behavior.
- [ ] Add additive migration and atomic insert/replay logic; refresh canonical schema/catalog and migration hashes.
- [ ] Add composer sync lock and reusable uncertain-attempt identity; browser regression for double-click and retry. Run RED then GREEN.
- [ ] Run focused backend/UI tests and record evidence; local commit after green.

### Task 2: Comments and consent-based applications

**Files:** new `Python/routers/request_interactions.py`, `requests.py`, `main.py`, new `0005_request_interactions.sql`, schema/Drizzle, gateway policy, OpenAPI/generated contracts, tests.

**Interfaces:** `GET/POST /requests/{id}/comments` (`body`, `parentId?`, `clientCommentId`); `GET/POST /requests/{id}/applications`; `PATCH /requests/{id}/applications/{applicationId}` (`action: accept|reject|cancel`); `GET /connections`; `GET /request-activity`. Existing `/match` becomes application alias. Return only own applications or author-visible applicant rows. Connection entries contain userId/name/requestId/requestTitle; request activity contains existing request response objects.

- [ ] Write RED tests for comments/replies, wrong-post parents, blocks/auth, pending-only application, owner-only accept/reject, applicant cancel/reapply, transition retries and competing accepts.
- [ ] Implement tables, transactional state transitions, legacy match preservation and matching alias. Keep match events attached to acceptance only.
- [ ] Add authenticated contacts/activity APIs, route allowlists, body limits and API contracts. Test unauthorized access and response bounds.
- [ ] Verify upgrade from 0003 preserves representative matched requests/chat rows and least-privilege grants; run focused integration tests and local commit.

### Task 3: Complete UI and verify release

**Files:** new request interaction client/components, Connections page, `RequestDetail.tsx`, `ConnectAction.tsx`, `ChatWidget.tsx`, `Navbar.tsx`, `App.tsx`, static route allowlist, browser fixtures/tests and release docs.

**Interfaces:** Render application state/actions and comments on request detail. Message by named contact opens existing DM widget/thread. My connections links owned/applied requests and accepted contacts. Query keys are scoped to account; mutation errors are visible.

- [ ] Add RED browser tests for comments/replies, apply/pending/accept, reject/cancel, name-based DM and legacy matched contact. Include refresh/account switching and click repetition.
- [ ] Implement UI against Task 2 contracts and preserve existing DM conversations. Replace the numeric-ID starter.
- [ ] Update obsolete immediate-Connect tests to assert application then owner acceptance; do not weaken access/race tests.
- [ ] Run full Python, gateway, DB/migrations, API generation/contracts, unit, Playwright, typecheck/build and secrets/diff checks. Record failures/skips distinctly.
- [ ] Document additive migration order, required grants, rollback/compatibility and pending remote approval. Obtain fresh whole-branch review, fix material findings, commit local results. No push/deploy.

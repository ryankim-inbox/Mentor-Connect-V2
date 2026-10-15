# Codebase Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the six findings from the 2026-10-03 repository review and remove confirmed unused frontend code and dependencies.

**Architecture:** Keep the existing React → same-origin gateway → FastAPI → PostgreSQL architecture. Repair validation and business rules where writes happen, reuse the current pytest/Playwright infrastructure, and make real Python/database checks part of the release gate. No new application framework, service, ORM, or feature subsystem is needed.

**Tech Stack:** Node 24.21.0, pnpm 10.33.0, TypeScript, React, Zod, Python >=3.12, FastAPI/Pydantic, psycopg2, PostgreSQL 16, pytest, Playwright.

**Spec:** The user's request to resolve the preceding review findings and this document's [Scope and decisions](#scope-and-decisions) form the maintenance specification. Runtime context: [release surface](../../release-surface.md). This is a proposed plan for review, not authorization to deploy or modify an existing populated database.

## Global Constraints

- Use Node `24.21.0` and pnpm `10.33.0`; CI Python is `3.12`, consistent with the release runtime. Local tests may use an existing compatible Python `>=3.12`.
- Add no application dependencies. Reuse the already-declared pytest dev dependency and pinned `uv 0.11.16` tooling for CI provisioning.
- Keep public REST/WebSocket paths and response fields unchanged; preserve gateway authentication, Origin checks, limits, redaction, and private upstream binding.
- Use `Python/db.py:db()` and parameterized SQL. Preserve transaction boundaries; never add SQLAlchemy or a second connection layer.
- Use isolated PostgreSQL clusters/databases for tests. Never load either fixture or canonical schema into the developer's populated database.
- Preserve student implementations. Do not restore completed work to TODO stubs, import answer modules into runtime code, or complete unrelated lessons just to make tests green.
- Keep the existing branch-scoped Python freeze policy. Do not remove checks to allow this maintenance work; execute on an appropriate maintenance branch after checking current repository instructions.
- Keep schema version `0002` and its checksum-pinned migrations unchanged; these fixes require no schema migration. Existing-data correction is a separate, explicit operator procedure.
- Keep the mockup workspace, generated API libraries, and legacy teaching fixtures intact. Cleanup estimates are candidates, not deletion quotas.
- UI copy remains English. Preserve accessible links, labels, alerts, and keyboard operation.

## Review Focus

1. A 120-byte Unicode name is valid; empty, whitespace-only, and 121-byte names must be rejected before persistence. Existing invalid accounts must have a repair path. → Task 1.
2. Blocking either direction after a DM socket has opened must prevent the next send from persisting or broadcasting. Historical reads stay available. → Task 2.
3. Two authenticated users connecting to the same open request must yield one winner, with its stored identity matching its successful response. → Task 3.
4. More than 50 room messages, equal timestamps, and soft-deleted rows must still produce the latest 50 visible messages in deterministic display order. → Task 4.
5. A developer fixing a student exercise must not break unrelated tests that assume it remains broken; missing test prerequisites must fail CI instead of silently skipping backend integration. → Tasks 5–6.

---

## Scope and decisions

Reviewed baseline: `28836a65e4c6a0a4edf14e5d8d715795076bbd96`. Recheck affected files at execution time; line numbers below are navigation aids.

| Finding | Chosen behavior | Task |
| --- | --- | --- |
| Empty registration names poison chat responses | Reject raw names over 120 UTF-8 bytes and names empty after trimming; persist the trimmed value. Apply the same rule to registration and profile writes. | 1 |
| Existing DMs bypass blocks | One shared pair-block guard, used on conversation start and every REST/WS send; denied REST sends return 403, denied sockets close with 4403. | 2 |
| Connect race overwrites a winner | Add `FOR UPDATE` to the existing request read before checking its status. Keep existing 400/401/404 behavior; no new API contract. | 3 |
| Room history freezes at 50 messages | Query newest visible rows by `created_at DESC, id DESC`, limit 50, then reverse that small result for ascending display. | 4 |
| CI omits Python and tests contain stale assumptions | Repair test isolation and missing scaffold helpers, then run the whole Python suite against disposable PostgreSQL from the release gate. | 5–6 |
| Recommendation action has no behavior | Replace “Request match” with a normal “Browse requests” link to `/requests`. A recommendation's question/mentor ID is not a mentorship request ID. | 7 |
| Unused UI files/dependencies and permanent flags | Remove only verified unused UI files/declarations; retain route constants and rendered features while removing always-true flag branches. | 7–8 |

The backend changes and their tests share `chat.py` and the existing integration fixtures, so one sequenced maintenance plan is smaller than separate backend/CI plans. Each task is independently reviewable and committed. Tasks 7–8 form a separable UI cleanup deliverable and can ship after the correctness fixes.

The block guarantee applies when a send checks permission after the block has committed. An already-authorized in-flight send may finish; this plan does not add distributed delivery revocation. All subsequent sends, including on an existing socket, must check again.

Existing invalid names are not silently rewritten on application startup. The repair runbook will identify affected accounts and provide a narrowly scoped transaction using reviewed IDs and `Member <id>` as a non-sensitive fallback; it must preserve messages and account identity.

## File responsibilities

| Files | Responsibility |
| --- | --- |
| `artifacts/api-gateway/src/request-controls.ts`, `src/gateway.ts` | Reuse existing bounded-string semantics for registration and profile validation. |
| `Python/routers/auth.py`, `Python/routers/users.py` | Enforce the same display-name rule at Python write boundaries. |
| `artifacts/peerbridge/src/pages/Register.tsx` | Explain/reject invalid names before submission. |
| `Python/routers/chat.py`, `Python/routers/requests.py` | Block enforcement, room-history selection, atomic Connect. |
| `tests/test_chat_integration.py`, new `tests/fixtures/chat-canonical.sql` | Real HTTP/WS and concurrent database regressions on canonical schema. |
| New `scripts/test-python.sh` | Disposable PostgreSQL lifecycle and execution of the Python suite. |
| `Python/mentor_ranks.py`, `tests/test_mentor_ranks.py`, `tests/test_python_only_adapters.py` | Repair shared lesson helpers and isolate tests from mutable exercise state. |
| `.github/workflows/release-surface.yml`, `scripts/verify-release.sh`, `scripts/test-verify-release.mjs` | Provision the existing Python test dependencies and enforce backend checks. |
| `Recommendations.tsx`, `Dashboard.tsx`, `lib/release-flags.ts`, frontend release test | Working navigation and removal of permanent flag branches. |
| PeerBridge `components/ui/`, `package.json`, root `pnpm-lock.yaml` | Remove unused frontend sources and direct dependency declarations. |
| New `docs/runbooks/account-name-repair.md`, existing release/chat documentation | Existing-data repair and truthful verification/behavior instructions. |

All frontend paths in the table are below `artifacts/peerbridge/src/` unless otherwise specified. Detailed task paths below are repository-relative.

## Task 1: Close the invalid-name write path

**Files:** Modify `artifacts/api-gateway/src/request-controls.ts:11-68`, `artifacts/api-gateway/src/gateway.ts:838-978`, `Python/routers/auth.py:8-27`, `Python/routers/users.py:9-14`, `artifacts/peerbridge/src/pages/Register.tsx:85-128`; extend `artifacts/api-gateway/test/request-controls.test.ts`, `artifacts/api-gateway/test/self-only.test.ts`, `e2e/auth.spec.ts`; create `tests/test_account_names.py` and `docs/runbooks/account-name-repair.md`.

**Interfaces:**
- Preserve `validateAuthBody(kind: "login" | "register", body: Buffer | undefined): { body: Buffer; accountKey: string }`.
- Move the existing `readBoundedString(value: unknown, maxBytes: number): string | undefined` unchanged from `gateway.ts` to an export in `request-controls.ts`; import it back into `gateway.ts`. Registration uses it with `120` and serializes the normalized name into the returned body. Login behavior stays unchanged.
- Add `normalize_display_name(value: str) -> str` in `Python/routers/auth.py`; raise `ValueError` for invalid input. Both `RegisterBody` and `UpdateUserBody` use Pydantic field validators; `users.py` imports this helper. Omitted/null optional PATCH names keep their existing no-op behavior.

- [ ] **Step 1: Add focused failing boundary tests.** In `tests/test_account_names.py`, test both models with the same values. In gateway tests, assert invalid registration bodies never reach upstream and valid registration forwards the trimmed name:
  ```python
  # test_display_name_boundaries, parametrized over registration and PATCH
  # reject via ValidationError: "", " \t\n", "x" * 121, "界" * 41
  assert validated_name("x" * 120) == "x" * 120
  assert validated_name("界" * 40) == "界" * 40
  assert validated_name("  Ada  ") == "Ada"
  ```
  `validated_name` here means constructing the selected existing Pydantic model and reading `.name`; no production wrapper is required. Gateway assertions: HTTP 400 for invalid input, zero upstream calls; valid body contains `name: "Ada"`. Browser test: whitespace-only/over-limit input displays `Use a name of 1–120 UTF-8 bytes.` and causes no registration request.
- [ ] **Step 2: Run the new tests and record the failure.** Run `.venv/bin/python -m pytest tests/test_account_names.py -q` and `pnpm --filter @workspace/api-gateway test`. Expected: current validators accept invalid names. The browser regression runs after building, as in Step 4.
- [ ] **Step 3: Apply the validation changes and write the repair procedure.** Check the byte limit on the raw string before trimming, matching existing profile validation. Python uses `len(value.encode("utf-8"))`; frontend uses `TextEncoder`. On registration, serialize only the normalized name; preserve other fields. The runbook must include a read-only preflight, reviewed-ID transaction, verification that affected histories/profile responses return 200, and rollback of names from protected operator evidence. Use `Member <id>` only for reviewed invalid rows; do not truncate valid names or delete messages. Do not execute repair against an existing database during development.
- [ ] **Step 4: Verify.** Run both commands from Step 2, `pnpm build:release`, and `pnpm exec playwright test e2e/auth.spec.ts`. Expected: all added boundary checks pass, including 120-byte Unicode input; existing profile/auth checks remain green. Existing-data remediation is complete only with zero affected rows or recorded operator repair evidence.
- [ ] **Step 5: Commit the task's listed files** with `fix: validate account names before persistence`.

## Task 2: Enforce blocks on every DM send, with canonical integration tests

**Files:** Modify `Python/routers/chat.py:235-263,402-448,475-489,589-626`, `tests/test_chat_missions_1_6.py`, `tests/test_chat_integration.py`, `docs/STUDENT_CHAT_BACKEND_GUIDE.md`; create `tests/fixtures/chat-canonical.sql` and `scripts/test-python.sh`.

**Interfaces:**
- Add `_require_unblocked_pair(cur, user_a_id: int, user_b_id: int) -> None` in `chat.py`: parameterized bidirectional block lookup; raise `HTTPException(403)` if either direction exists.
- Existing `start_dm_conversation`, `send_dm_message`, and `dm_socket` use this helper. Preserve `_load_conversation_membership(...) -> dict` and all message shapes.
- Preserve `chat_database` (DSN), `chat_server` (context-manager factory yielding HTTP origin), `api(...)`, and `login(...)` test helpers. Change only the database fixture's schema/data source.
- `sh scripts/test-python.sh [pytest arguments...]` runs the requested tests, or defaults to the whole `tests` directory. `PYTHON_BIN` selects an interpreter; default is the repository's `.venv/bin/python`. It creates its own loopback PostgreSQL cluster and sets `CHAT_TEST_ADMIN_DSN` and `MENTOR_RANKS_TEST_DSN` to that cluster, never to ambient application credentials.

- [ ] **Step 1: Add canonical test data and the disposable runner needed for this regression.** Reuse lifecycle patterns from `lib/db/test/disposable-postgres.sh`; allocate a private temporary directory and free port, stop only the process created by this run, and preserve the pytest exit code. Missing interpreter/PostgreSQL tools must fail. In `chat_database`, execute `database/schema/canonical.sql` followed by the new data-only fixture instead of the legacy 1,000-user SQL. Call `pnpm --filter @workspace/db schema:check` before tests. Keep the test identities used today: users `1`, `2`, `501`, `502`, `951`; districts `1`, `2`; tag `1`; global room `1`, district rooms `2`, `3`; DMs `1` (1/501) and `2` (1/951); block `1 → 502`. Preserve four visible global messages, three visible DM-1 messages, deleted-message coverage, existing login emails/password, and reset sequences after explicit IDs. No production fixtures change.
- [ ] **Step 2: Add and run the failing regressions.** Add `test_existing_dm_enforces_new_blocks` parametrized over which participant blocks. Open both sockets before blocking through REST; after block success assert:
  ```python
  assert api(sender, base, "POST", "/api/dms/1/messages", {"body": "blocked"})[0] == 403
  # Send on the already-open sender socket:
  assert closed_code == 4403
  assert persisted_message_count_after == persisted_message_count_before
  assert recipient_received_blocked_message is False
  assert api(sender, base, "GET", "/api/dms/1/messages")[0] == 200
  ```
  Also reject a newly opened socket for the blocked pair; after unblocking, REST and a new socket can send normally. Use bounded socket waits and database counts, not only fake SQL expectations. Run `sh scripts/test-python.sh tests/test_chat_integration.py -k 'existing_dm_enforces_new_blocks' -q`; expected before the fix: a send succeeds or persists after blocking.
- [ ] **Step 3: Implement the shared guard.** Replace the existing inline start-DM block check with the helper. For REST sends, check membership then both block directions inside the insert transaction. For sockets, check at handshake and again with membership before every insert; on access failure close with 4403, leave the loop, and let `finally` unregister the socket. Do not catch unrelated database failures as authorization errors. Keep historical GET access unchanged.
- [ ] **Step 4: Verify both transports and existing behavior.** Update strict scripted-cursor expectations for the new guard, preserving their parameter assertions. Add `test_registration_names_cannot_poison_room_history` using the canonical fixture to integrate Task 1: invalid registration returns 422 from Python and leaves the users count unchanged; valid padded-name registration returns the trimmed name, its room POST returns 201, and history contains that message with the trimmed `senderName`. Run `sh scripts/test-python.sh tests/test_chat_missions_1_6.py tests/test_chat_integration.py -q`. Expected: no failures/skips; district isolation, nonparticipant rejection, body limits, persistence, reconnects, and both block directions pass on schema 0002. Update the guide to describe per-send enforcement.
- [ ] **Step 5: Commit the task's listed files** with `fix: enforce blocks throughout existing DM conversations`.

## Task 3: Make Connect atomic

**Files:** Modify `Python/routers/requests.py:214-236` and `tests/test_chat_integration.py`.

**Interfaces:** Consume Task 2's disposable runner/DSN and HTTP helpers. Preserve `match_request(request_id: int, request: Request)` and its current wire response/status conventions.

- [ ] **Step 1: Add `test_concurrent_connect_has_exactly_one_winner`.** Create an open request owned by user 1, log in users 501 and 951 separately, and hold a row lock on that request from a third database connection. Start both HTTP Connect calls using two workers; with a bounded deadline, wait until PostgreSQL reports both workers waiting for a lock, then release the held lock. This forces the old code's two unlocked reads to precede either update. Assert:
  ```python
  assert sorted(status for status, _ in results) == [200, 400]
  assert stored_request["matchedUserId"] == successful_caller_id
  assert successful_response["matchedUserId"] == successful_caller_id
  ```
  Release the held lock in `finally`. Add/reuse assertions that author/anonymous/missing/already-matched requests retain their current error statuses and do not change the winner.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_chat_integration.py -k concurrent_connect -q`. Expected failure: both old Connect calls return 200; do not rely on probabilistic repeated racing or arbitrary sleeps.
- [ ] **Step 3: Lock the row before checking it.** Change the existing SELECT inside `match_request` to `SELECT * FROM requests WHERE id = %s FOR UPDATE`; retain checks and the UPDATE in the same `db()` transaction. No process mutex, retries, new index, or endpoint is needed.
- [ ] **Step 4: Verify** with the Task 2 integration command plus `pnpm test:gateway`. Expected: exactly one match succeeds; losing attempts cannot overwrite it; existing gateway contract stays green.
- [ ] **Step 5: Commit the two listed files** with `fix: serialize competing Connect requests`.

## Task 4: Return the latest room-history window

**Files:** Modify `Python/routers/chat.py:340-359`, `tests/test_chat_missions_1_6.py`, `tests/test_chat_integration.py`, and the history section of `docs/STUDENT_CHAT_BACKEND_GUIDE.md`.

**Interfaces:** Preserve `list_room_messages(room_id: int, request: Request)` returning the existing message array; keep the 50-message limit and existing room-authorization helper.

- [ ] **Step 1: Add `test_room_history_returns_latest_visible_window`.** Insert 60 visible messages into an isolated room, with equal timestamps to exercise the ID tie-breaker, plus a newer soft-deleted row. Assert exactly the newest 50 visible IDs are returned in ascending `(createdAt, id)` order. Post message 61 through HTTP and assert the next GET includes its ID and drops the oldest item from the prior window. Retain empty-room and <50-message cases.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_chat_integration.py -k latest_visible_window -q`. Expected failure: the old response excludes the newest messages.
- [ ] **Step 3: Change only selection and display order.** Keep `deleted_at IS NULL`, select with `ORDER BY m.created_at DESC, m.id DESC LIMIT 50`, then format `reversed(messages)`. Do not load full history, add pagination endpoints, or switch the frontend to WebSockets for this fix.
- [ ] **Step 4: Verify** using Task 2's integration command. Update the one scripted query expectation and the guide to say “latest 50 visible messages, displayed oldest to newest.” Expected: overflow, timestamp ties, deletion, small histories, and authorization checks pass.
- [ ] **Step 5: Commit the task's listed files** with `fix: keep room polling on the latest messages`.

## Task 5: Make Python tests independent of exercise progress

**Files:** Modify `Python/mentor_ranks.py`, `tests/test_mentor_ranks.py`, and `tests/test_python_only_adapters.py`.

**Interfaces:** Preserve the current student `rank_data`, `sort_mentors`, `assign_ranks`, and `badge_for_rank` implementations. Restore the documented `_require_user(request: Request) -> int`; preserve `_public_row(row: dict) -> dict` with nullable rank/badge and `_todo(mission: int, message: str) -> dict`. Preserve `integration_api._import_student_module(module_name)` as the monkeypatch boundary used by existing adapter tests.

- [ ] **Step 1: Reproduce the current four failures.** Run `sh scripts/test-python.sh tests/test_mentor_ranks.py tests/test_python_only_adapters.py -q`. At the reviewed baseline, three tests reach an undefined `_require_user`, and analytics expects a syntax error that the edited exercise no longer contains. Record any changed baseline before editing.
- [ ] **Step 2: Replace stale assumptions with explicit assertions.** Keep anonymous list/get assertions at 401 before DB access. Replace the old list-TODO test with `test_student_list_route_formats_stubbed_rank_data`: monkeypatch `rank_data` to `[{"id": 7, "name": "Ada", "matched_count": 2}, {"id": 8, "name": "Bo", "matched_count": 0}]`, call the existing ASGI helper, then assert:
  ```python
  assert status == 200
  assert rows == [
      {"mentorId": 7, "mentorName": "Ada", "matchedCount": 2, "rank": 1, "badge": "Master"},
      {"mentorId": 8, "mentorName": "Bo", "matchedCount": 0, "rank": None, "badge": None},
  ]
  ```
  Keep the currently unfinished single-mentor endpoint's Mission 6 TODO and exact guide path `docs/STUDENT_MENTOR_RANKS_GUIDE.md`. For analytics import failure, monkeypatch `_import_student_module` to return `(None, {"status": "import error", "error": "SyntaxError: injected"})`; assert `source == "python"`, `success is False`, and `data is None`. For scheduling runtime failure, use an existing `fake_module` whose function raises `RuntimeError("injected")`; assert the same failure envelope and `student_module.status == "runtime error"`. Make the import-success status test use `fake_module("scheduling")` too. Keep separate success tests using `fake_module`; no test should contact an arbitrary host embedded in an exercise.
- [ ] **Step 3: Restore only missing/broken shared helpers.** Add the small session guard rather than importing an answer module. Move the accidentally embedded test functions and pytest/mock imports out of `Python/mentor_ranks.py` into its test file. Make `_public_row` use the existing `badge_for_rank` and preserve `None` ranks; fix `_todo` to use the existing guide path. Preserve completed mission bodies and the unfinished Mission 6 route. Do not expose this router through the production gateway.
- [ ] **Step 4: Verify** `sh scripts/test-python.sh`. Expected: the complete default Python suite passes with zero skips because both DB test DSNs are supplied. Keep default answer-module algorithm tests and student-route safety tests; do not weaken assertions to accept either arbitrary success or failure.
- [ ] **Step 5: Commit the three listed files** with `test: isolate Python checks from mutable lesson progress`.

## Task 6: Put real Python checks into the release gate

**Files:** Modify `.github/workflows/release-surface.yml`, `scripts/verify-release.sh`, `scripts/test-verify-release.mjs`, and `docs/runbooks/classroom-release.md`.

**Interfaces:** Consume Task 2's `scripts/test-python.sh` and `PYTHON_BIN` override. Continue calling the existing `pnpm verify:release` entry point. Set `CLASSROOM_TEST_PYTHON` to that same absolute interpreter path so the existing canonical classroom bootstrap test no longer skips its real Python path.

- [ ] **Step 1: Extend the existing release-script test.** Assert `--print` includes `sh scripts/test-python.sh` before frontend build/browser verification, preserves all existing checks, and uses the interpreter for the real classroom DB test. Assert the workflow provisions Python test dependencies without production secrets. Keep the existing failure-propagation test; add a simulated backend-check nonzero exit and assert later checks do not run. Run `node scripts/test-verify-release.mjs`; expected failure: Python verification/provisioning is missing.
- [ ] **Step 2: Provision the existing locked dev environment in CI.** Install pinned `uv==0.11.16` into an isolated tools venv under `RUNNER_TEMP`, add its bin directory to `GITHUB_PATH`, then run `UV_PROJECT_ENVIRONMENT="$RUNNER_TEMP/mentor-python" uv sync --frozen --python 3.12 --group dev`. Export absolute `PYTHON_BIN` and `CLASSROOM_TEST_PYTHON` paths through `GITHUB_ENV`. Reuse the workflow's PostgreSQL 16 tools. No new action dependency, deployment credentials, dependency bypass, or test-only package in the production runtime is needed.
- [ ] **Step 3: Enforce the backend check locally and in CI.** In `verify-release.sh`, resolve/export `PYTHON_BIN` (default absolute `.venv/bin/python`) and `CLASSROOM_TEST_PYTHON`; add `run sh scripts/test-python.sh` in the documented order. Preserve `--print` as non-executing and preserve the scoped Python freeze checks. Missing prerequisites and pytest failures must propagate. Document `uv sync --frozen --group dev` for local setup and the disposable runner for focused checks.
- [ ] **Step 4: Verify** `node scripts/test-verify-release.mjs`, `CLASSROOM_TEST_PYTHON="$PWD/.venv/bin/python" pnpm --filter @workspace/db test`, and `pnpm verify:release`. Expected: full Python success, no skipped real classroom bootstrap test, and the existing release sequence passes. A dependency-network/tool prerequisite failure is an execution limitation to report, not a passing release.
- [ ] **Step 5: Commit the task's listed files** with `ci: require Python and canonical database integration checks`.

## Task 7: Replace the dead action and remove permanent flags

**Files:** Modify `artifacts/peerbridge/src/pages/Recommendations.tsx:534-543`, `artifacts/peerbridge/src/pages/Dashboard.tsx`, `artifacts/peerbridge/src/lib/release-flags.ts`, `artifacts/peerbridge/test/release-surface.test.ts`, and `e2e/learning-surface.spec.ts`.

**Interfaces:** Keep `releaseSurface.appRoutes` and its current route strings unchanged. Remove `releaseFeatureDefinitions`, `ReleaseFeature`, `featureFlags`, and `isFeatureEnabled` after removing all consumers. No matching API or new component is introduced.

- [ ] **Step 1: Add a browser regression with one valid recommendation.** Use the existing API interception setup, populate `matches` with a valid mentor record, then assert:
  ```typescript
  await expect(page.getByRole("link", { name: "Browse requests", exact: true })).toHaveAttribute("href", "/requests");
  await expect(page.getByRole("button", { name: "Request match", exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "Browse requests", exact: true }).click();
  await expect(page).toHaveURL(/\/requests$/);
  ```
- [ ] **Step 2: Build and run the focused regression.** Run `pnpm build:release` then `pnpm exec playwright test e2e/learning-surface.spec.ts`. Expected before repair: the working link is absent.
- [ ] **Step 3: Use the existing Wouter `Link`, simplify the always-true branches.** Replace the inert button with `<Link href={releaseSurface.appRoutes.requests}>Browse requests</Link>` using existing styling. Render matching stats unconditionally. Keep `PracticeLab !== undefined` checks: component availability is distinct from a permanent flag. Remove obsolete flag assertions from the release test; retain route inventory checks. Keep the file name to avoid unrelated import churn.
- [ ] **Step 4: Verify** `pnpm build:release`, `pnpm --filter @workspace/peerbridge test:unit`, and `pnpm exec playwright test e2e/learning-surface.spec.ts e2e/classroom-flow.spec.ts`. Expected: the link navigates; all destinations, dashboard practice tab, and request-detail Connect still work. Whole-tree search must find no executable consumers of removed flags.
- [ ] **Step 5: Commit the task's listed files** with `fix: make recommendation navigation actionable`.

## Task 8: Prune confirmed unused UI files and dependencies

**Files:** Delete verified candidates only under `artifacts/peerbridge/src/components/ui/`; modify `artifacts/peerbridge/package.json` and `pnpm-lock.yaml`. Keep the mockup workspace untouched.

**Interfaces:** No runtime interface changes. Keep these eight currently reachable UI modules: `button`, `input`, `scroll-area`, `spinner`, `tabs`, `toast`, `toaster`, `tooltip`.

- [ ] **Step 1: Revalidate the deletion inventory.** Search the whole tracked tree, including tests, fixtures, aliases, generated registries, and dynamic/string references, for each file and exported symbol. Check both runtime and build/config use before removing a package. Baseline candidate stems (all `.tsx` under the directory above):
  ```text
  accordion alert alert-dialog aspect-ratio avatar badge breadcrumb button-group
  calendar card carousel chart checkbox collapsible command context-menu dialog
  drawer dropdown-menu empty field form hover-card input-group input-otp item kbd
  label menubar navigation-menu pagination popover progress radio-group resizable
  select separator sheet sidebar skeleton slider sonner switch table textarea
  toggle toggle-group
  ```
  Candidate PeerBridge dependency declarations:
  ```text
  @hookform/resolvers
  @radix-ui/react-accordion @radix-ui/react-alert-dialog @radix-ui/react-aspect-ratio
  @radix-ui/react-avatar @radix-ui/react-checkbox @radix-ui/react-collapsible
  @radix-ui/react-context-menu @radix-ui/react-dialog @radix-ui/react-dropdown-menu
  @radix-ui/react-hover-card @radix-ui/react-label @radix-ui/react-menubar
  @radix-ui/react-navigation-menu @radix-ui/react-popover @radix-ui/react-progress
  @radix-ui/react-radio-group @radix-ui/react-select @radix-ui/react-separator
  @radix-ui/react-slider @radix-ui/react-switch @radix-ui/react-toggle
  @radix-ui/react-toggle-group cmdk date-fns embla-carousel-react framer-motion
  input-otp next-themes react-day-picker react-hook-form react-icons
  react-resizable-panels recharts sonner vaul zod
  ```
  Remove a candidate from the list if execution-time evidence shows a real consumer. Do not add a permanent dependency-analysis package or a test that merely counts deleted files.
- [ ] **Step 2: Remove verified files and declarations together.** Keep all required UI accessibility primitives. Regenerate `pnpm-lock.yaml` using the pinned pnpm version, without broad upgrades or relaxed overrides. Shared packages may remain in the lockfile because other workspaces need them.
- [ ] **Step 3: Verify against existing behavior checks.** Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build:release`, `pnpm --filter @workspace/peerbridge test:unit`, and `pnpm e2e`. Expected: no missing import or runtime chunk failures; all browser checks pass. Inspect the diff to ensure only approved sources/declarations and necessary lockfile entries changed.
- [ ] **Step 4: Commit only the verified cleanup files** with `chore: remove unused PeerBridge UI scaffolding`.

## Final verification and delivery

- [ ] Run `pnpm verify:release` once on the final tree. Save the actual counts/results; do not reuse this audit's earlier passing counts as evidence for changed code.
- [ ] Run the existing production/toolchain dependency audits required by CI; unused-dependency removal must not weaken that gate.
- [ ] Review the complete diff for the five Review Focus cases and scope creep. Confirm generated API clients and pinned migration assets have no unintended edits.
- [ ] Report separately: unit/script tests, canonical PostgreSQL HTTP/WS/concurrency tests, fixture-backed browser tests, and any staging checks actually performed.
- [ ] Before a deployment is declared repaired, follow the name-repair preflight for that environment. Application tests alone do not prove existing stored names were corrected. Keep operator evidence private and outside Git.
- [ ] Report actual deleted lines and removed direct dependency declarations. The audit's 5,416-line/37-declaration estimate is not a required result and does not imply all packages disappear from the workspace lockfile.

## Plan self-review and handoff

Coverage: name poisoning → Task 1; block bypass → Task 2; Connect race → Task 3; stale room window → Task 4; Python failures/CI omission → Tasks 5–6; inactive action → Task 7; flag/dependency/UI bloat → Tasks 7–8. All five Review Focus cases have named checks. Tests and task interfaces preserve the existing route/status contracts and explicitly distinguish current schema from legacy teaching data.

Recommended execution: **Native**, in task order, followed by one independent whole-branch review. The changes share existing Python helpers and integration fixtures, so a single implementer avoids repeated handoffs. Subagent-driven execution remains an option if independent review after each task is preferred.

Implementation begins only after the user reviews this plan and chooses the execution method. Create/reuse an isolated maintenance checkout at execution time; this planning task changes only this document.

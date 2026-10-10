# Backend Reliability and Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all nine backend audit findings, complete the active learning endpoints, and record real future match events so end-to-end tests establish feature correctness rather than server liveness alone.

**Architecture:** Keep the existing Python → PostgreSQL implementation behind the gateway. Bound existing list responses, repair transaction/input boundaries, and complete the existing student modules. Add one additive event table for observed future matches and update analytics/UI semantics without inventing historical response data.

**Tech Stack:** Python 3.12+, FastAPI/Pydantic, psycopg2/psycopg, PostgreSQL 16, pytest, Node 24.21.0, pnpm 10.33.0, TypeScript, React/TanStack Query, existing OpenAPI generators and Playwright.

**Spec:** [Backend reliability and completion design](../specs/2026-10-10-backend-completion-design.md). Read that document before this plan; its contracts and exclusions apply to every task.

## Global Constraints

- Target Python 3.12+, PostgreSQL 16, Node 24.21.0 and pnpm 10.33.0; retain the repository's pinned uv tooling.
- Keep one Python worker and one gateway process for the documented approximately 20-user classroom deployment.
- Keep Python private on loopback; preserve gateway authentication, Origin checks, redaction, rate limits and the 2,097,152-byte response ceiling.
- Use configured database connections, parameterized SQL and existing transaction helpers; no hardcoded database hosts.
- Tests use disposable databases and synthetic accounts only; never reseed, migrate or repair a populated user database during development.
- Never edit checksum-pinned migrations 0001/0002; add the next migration and regenerate the canonical schema/catalog through the existing process.
- No new production dependency is required; align the uv test environment with the already-required psycopg driver.
- Preserve successful completed lessons and existing authentication/blocking fixes; never restore them to TODO states.
- UI copy stays English; retain keyboard access, loading/error states and accurate empty-state messages.
- A green health check or HTTP 200 failure envelope is not feature completion. Required success paths must use real module results.

## Review Focus

1. Already-stored oversized text, multibyte text and escaped JSON must not defeat list bounds or cause stored data to be silently overwritten. → Task 1.
2. Equal timestamps, a new insert between pages and a tag match outside the first page must preserve deterministic paging with filters applied before LIMIT. → Task 1.
3. Two concurrent starts/matches, a rollback and a reopened request must produce one canonical conversation and exactly the real committed events. → Tasks 3 and 10.
4. A UTC week/year boundary and a partially observed week must distinguish no matches from no tracking; empty averages are null. → Tasks 11 and 13.
5. Simultaneous module reloads, malformed numeric student output and a failing block query must yield bounded errors without stale success, deadlocks or unsafe recommendations. → Tasks 2 and 9.

---

## Baseline, execution order and file ownership

Planning baseline: latest remote main `1dfef50bfbfa39c262f5f3a31b3d0f266bae2242`; PR #20 was open. The local checkout is older and has an unrelated untracked October 3 plan. Preserve it. At execution, use the worktree skill to obtain an isolated checkout from current main, record its SHA, inspect repository instructions and recheck PR #20. Do not reset the user's checkout or duplicate fixes already merged.

Recommend three separately reviewed delivery batches rather than one undifferentiated change: **A: Tasks 1–9**, **B: Tasks 10–15**, **C: Task 16**. Each task has its own regression and commit. Shared fixture/schema/generated-client files make sequential integration simpler than concurrent edits. Task 10 must be deployed with the migration before code that writes events; do not deploy partly updated analytics.

| Responsibility | Files |
| --- | --- |
| Reusable real-server test setup | New `tests/backend_support.py`, `tests/support/gateway-server.ts`; existing `tests/conftest.py`, `tests/test_chat_integration.py`, `tests/fixtures/chat-canonical.sql` |
| Bounded request browsing | `Python/routers/requests.py`, gateway route policy/public contract, OpenAPI/generated clients, Requests/DistrictDetail/Dashboard/NewRequest/RequestCard |
| Safe matching/moderation data | `Python/get_blocks.py`, `Python/find_matches.py`, admin adapter, dependency lock alignment |
| DM creation/history | `Python/routers/chat.py`, chat tests, ChatWidget, chat guide |
| Product field/filter/statistics fixes | `Python/routers/requests.py`, `reports.py`, `users.py`, `districts.py`, `stats.py` |
| Safe module integration | `Python/integration_api.py`, `Python/api/adapters/probe.py`, adapter normalization tests |
| Match events and schema assets | New migration and `Python/request_events.py`; requests router; migration ledger/canonical catalog/Drizzle/DB tests/operator documentation |
| Real analytics and schedules | `Python/analysis.py`, `scheduling.py`, their adapters, Analytics page |
| Completed reporting and locations | `Python/reports.py`, `get_blocks.py`, new `locations.py`, adapters and related pages |
| Mentor Mission 6 | `Python/mentor_ranks.py`, rank tests and guide; coordinate PR #20 |
| Completion gate | New `tests/test_backend_completion.py`, existing Python/release runners, workflow, browser tests and runbooks |

All paths below are repository-relative. Run Python integration commands through `sh scripts/test-python.sh`; it provides both test DSNs and owns cleanup. After dependency setup use `uv sync --frozen --group dev`; missing prerequisites or skipped required DB checks are failures, not passes. Stage only files owned by the task before its named commit.

## Task 1: Keep request browsing available and pageable

**Files:** Modify `Python/routers/requests.py:29-114`, `artifacts/api-gateway/src/route-policy.ts`, `artifacts/api-gateway/src/public-contract.ts`, `lib/api-spec/openapi.yaml`, `artifacts/peerbridge/src/pages/{Requests,DistrictDetail,Dashboard,NewRequest}.tsx`, `artifacts/peerbridge/src/components/RequestCard.tsx`, `tests/conftest.py`, `tests/test_chat_integration.py`; create `tests/backend_support.py`, `tests/support/gateway-server.ts`, `tests/test_request_feed.py`; extend `artifacts/api-gateway/test/{route-policy,public-contract}.test.ts`, `e2e/learning-surface.spec.ts`; regenerate `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/`.

**Interfaces:** `list_requests(districtId=None, role=None, status=None, tagId=None, limit: int=50, before: str|None=None) -> list[dict]`; add `parse_request_cursor(value: str) -> tuple[datetime,int]` and a UTF-8-safe list preview helper local to `requests.py`. Public rows gain `descriptionTruncated: bool`; cursor/limits are specified in A1. Dashboard consumes `limit=5`.

For tests, move the existing real HTTP helpers into `backend_support.py`, preserving `api(client, base, method, path, body=None) -> tuple[int,Any]` and `login(base,email) -> tuple[OpenerDirector,str]`. Put reusable `backend_database` and `backend_server` fixtures in conftest (canonical schema plus existing synthetic fixture); retain `chat_database`/`chat_server` fixture aliases so old tests do not change behavior. `gateway_server` yields a gateway base URL forwarding to its own backend; its small TS entrypoint imports the real `createGatewayServer`, uses ephemeral loopback ports and normal auth/response limits. All owned processes/DBs close in `finally`.

- [ ] **Step 1: Add failing request-feed tests.** `test_request_utf8_limits` asserts title 200/201 bytes and description 4000/4001 bytes are accepted/rejected; whitespace-only input is 422. `test_legacy_large_feed_survives_gateway` inserts three legacy 750,000-character descriptions directly into the disposable DB and asserts `status == 200`, all previews are bounded, `descriptionTruncated is True`, and stored lengths stay 750000. `test_cursor_filters_before_limit` creates 120 rows, ties timestamps, places tagged rows late, inserts a newer row between page reads, then asserts:
  ```python
  assert len(page1) == 50
  assert set(ids(page1)).isdisjoint(ids(page2))
  assert ids(page1 + page2) == expected_first_100_before_new_insert
  assert all(row_has_requested_tag(row) for row in tagged_page)
  ```
  Here `ids` and `row_has_requested_tag` are test-local projections, not production helpers. Add gateway tests for duplicate/invalid cursors and route-specific limits (requests 50, matching 20). Browser assertions cover older/newer navigation, filter reset and preview disclosure.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_request_feed.py -q` and `pnpm --filter @workspace/api-gateway test`. Expected new failures: oversized writes accepted, legacy feed 502, missing cursor support. Preserve the original chat integration behavior after fixture extraction.
- [ ] **Step 3: Implement A1 end to end.** Validate raw byte lengths, trim text, move all filtering into SQL and add deterministic tuple paging. Bound only list previews; never truncate database rows. Add precise gateway query validation without relaxing matching's limit. Regenerate clients with `pnpm api:generate`; update every list consumer and creation form. Extend request serialization with the boolean in both detail (false) and list results.
- [ ] **Step 4: Verify** `sh scripts/test-python.sh tests/test_request_feed.py tests/test_chat_integration.py -q`, `pnpm api:contract-test`, `pnpm test:gateway`, `pnpm build:release`, and `pnpm exec playwright test e2e/learning-surface.spec.ts`. Expected all pass; boundary cases cannot exceed the gateway ceiling. Document legacy-detail inspection in the eventual completion runbook.
- [ ] **Step 5: Commit** `fix: bound and paginate mentorship request browsing`.

## Task 2: Enforce blocks in real recommendations

**Files:** Modify `Python/get_blocks.py:17-29`, `Python/find_matches.py:180-190`, `pyproject.toml`, `uv.lock`; create `tests/test_matching_blocks.py`. Reuse Task 1 fixtures.

**Interfaces:** `receive_block_data() -> list[tuple[int,int]]` uses `db.db()`/column values; `_load_block_pairs() -> set[tuple[int,int]]` propagates lookup failure to `find_matches(question_id: int, limit: int=5) -> dict`, which returns the existing matching error envelope. The test environment gains the already-production-required `psycopg[binary]>=3.2.3` entry.

- [ ] **Step 1: Add tests** `test_matching_filters_both_block_directions_before_limit`, `test_matching_block_failure_is_not_success`, and `test_matching_uses_configured_database`. Synthetic user 1 blocks otherwise-best mentor 502; reverse the pair in a second case. Assert no blocked ID is returned, another eligible mentor fills its position, and an injected block query failure produces `success is False`, `matches == []`, `status == "database error"`.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_matching_blocks.py -q`. Expected failure reproduces the blocked mentor in successful output; after aligning dependencies, no failure may be attributed to an absent declared production driver.
- [ ] **Step 3: Implement the configured lookup and failure propagation.** Remove the hardcoded host and empty-set-on-exception behavior. Keep both-direction filtering before scoring/limiting; do not duplicate matching in the gateway. Update uv.lock with the repository's pinned uv tool.
- [ ] **Step 4: Run** the Task 2 test command and `sh scripts/test-python.sh tests/test_python_only_adapters.py -q`. Expected successful real matching and explicit safe failures; test through the gateway as well as the function boundary.
- [ ] **Step 5: Commit** `fix: fail safely when recommendation block checks fail`.

## Task 3: Make simultaneous DM starts idempotent

**Files:** Modify `Python/routers/chat.py:416-450`, `tests/test_chat_integration.py`.

**Interfaces:** Preserve `start_dm_conversation(body: StartDmBody, request: Request) -> dict`, status 200 and the current response fields.

- [ ] **Step 1: Add `test_concurrent_dm_start_returns_one_conversation`.** Hold a SHARE table lock in a separate disposable-DB connection, launch both directions of one new pair, observe both INSERTs waiting through `pg_stat_activity`, then release in `finally`. Assert:
  ```python
  assert sorted(statuses) == [200, 200]
  assert responses[0]["id"] == responses[1]["id"]
  assert stored_pair_count == 1
  ```
  Retain nonexistent/self/blocked-user checks. Use bounded condition polling, not arbitrary sleeps.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_chat_integration.py -k concurrent_dm_start -q`. Expected old result: one 500/UniqueViolation.
- [ ] **Step 3: Implement conflict-safe insert/reselect** inside the existing transaction as specified in A3. Do not add process mutexes or retry loops.
- [ ] **Step 4: Run** `sh scripts/test-python.sh tests/test_chat_integration.py tests/test_chat_missions_1_6.py -q`. Expected both starts succeed and existing REST/WS block/membership checks pass.
- [ ] **Step 5: Commit** `fix: reuse concurrently created DM conversations`.

## Task 4: Bound DM history and read marking

**Files:** Modify `Python/routers/chat.py:453-474`, `tests/test_chat_integration.py`, `artifacts/peerbridge/src/components/ChatWidget.tsx`, `docs/STUDENT_CHAT_BACKEND_GUIDE.md`; create `tests/test_dm_history.py`; extend `e2e/classroom-flow.spec.ts`.

**Interfaces:** Preserve `list_dm_messages(conversation_id: int, request: Request) -> list[dict]`; return newest 50 visible messages in ascending display order. Reuse membership helpers and the Task 1 gateway fixture.

- [ ] **Step 1: Add `test_dm_history_bounded_visible_and_read_window`.** Seed 270 messages of 2,000 emoji, equal timestamps, one deleted newest row and incoming messages outside the window. Assert gateway 200, `len(rows) == 50`, deterministic newest visible IDs, only returned incoming IDs become read, existing read timestamps remain unchanged, and total stored messages are unchanged. Cover 0/1/49/50 messages and outsider/anonymous access.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_dm_history.py -q`. Expected old gateway response: 502 and excessive read marking.
- [ ] **Step 3: Query the bounded window before marking read.** Restrict the UPDATE to selected incoming IDs, retrieve/use actual read timestamps in the returned rows, reverse the bounded result, and label a full window “Latest 50 messages” in ChatWidget. Do not apply a response-only slice after loading everything.
- [ ] **Step 4: Run** the Task 4 command, `sh scripts/test-python.sh tests/test_chat_integration.py -q`, and `pnpm exec playwright test e2e/classroom-flow.spec.ts` after `pnpm build:release`. Expected no gateway overflow and unchanged message persistence/block behavior.
- [ ] **Step 5: Commit** `fix: bound DM history without marking unseen messages read`.

## Task 5: Reject invalid writes before database failures

**Files:** Modify `Python/routers/requests.py`, `Python/routers/reports.py`, `Python/routers/matches.py`, `lib/api-spec/openapi.yaml`; create `tests/test_backend_input_validation.py`; regenerate the generated API directories from Task 1.

**Interfaces:** Preserve endpoint names/response shapes. Request models use the enums, positive IDs, unique tag list/max 20, state transitions and error statuses in A4. `MatchRequest` validates positive `question_id` and `limit` 1–20. Expected referential races map narrowly to 404; unexpected DB failures remain errors.

- [ ] **Step 1: Add parameterized `test_invalid_product_writes_are_4xx`.** Invalid role/status, nonpositive IDs, duplicate tags and 21 tags → 422; nonexistent district/tag/reported user → 404; self-report → 400. Assert DB row/tag counts unchanged. Add `test_request_state_transition_contract`: unmatched PATCH→matched is 409, retaining a matched state is a no-op, reopen clears the counterpart, and nonowners stay 403.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_backend_input_validation.py -q`. Expected initial 500s, accepted malformed models or incorrect state transitions.
- [ ] **Step 3: Implement model and transaction-boundary validation.** Validate referenced rows before mutations and retain rollback; catch only the identified psycopg2 foreign-key exception for the expected missing reference. Apply the existing row-lock pattern to status changes. Do not convert arbitrary SQL errors into successful envelopes. Regenerate the API contract.
- [ ] **Step 4: Run** the Task 5 command, `pnpm api:contract-test`, `pnpm test:gateway`, and the concurrent Connect regression in `tests/test_chat_integration.py`. Expected valid writes retain 201/200/204, invalid writes are bounded 4xx, and exactly one Connect winner persists.
- [ ] **Step 5: Commit** `fix: validate product write contracts before persistence`.

## Task 6: Clear nullable biographies correctly

**Files:** Modify `Python/routers/users.py:55-73`; create `tests/test_profile_updates.py`.

**Interfaces:** Preserve `update_user(user_id: int, body: UpdateUserBody, request: Request)`; use field presence for bio only.

- [ ] **Step 1: Add `test_profile_bio_null_empty_and_omitted`.** Through the real gateway assert null-only PATCH returns 200 and stores SQL NULL; empty string stores empty string; omitted bio remains unchanged; a combined name/null patch clears bio; cross-user PATCH stays 403.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_profile_updates.py -q`. Expected null-only failure 400 and combined update retaining old bio.
- [ ] **Step 3: Use** `"bio" in body.model_fields_set` to decide whether to append the bio assignment. Preserve other optional-field behavior and name validation.
- [ ] **Step 4: Run** the Task 6 command plus `pnpm --filter @workspace/api-gateway test`. Expected all null/omission/auth cases pass.
- [ ] **Step 5: Commit** `fix: honor explicit null biography updates`.

## Task 7: Apply both district type filters

**Files:** Modify `Python/routers/districts.py:24-41`; create `tests/test_district_filters.py`.

**Interfaces:** Preserve `list_districts(type: str|None=None, search: str|None=None)`; supported public values stay high_school/unified.

- [ ] **Step 1: Add `test_district_type_and_search_intersection`.** Seed both types with overlapping names. Assert unified returns only unified, high_school only high_school, type+search intersects correctly, omitted type returns both and unmatched search returns `[]`.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_district_filters.py -q`. Expected unified includes high-school rows.
- [ ] **Step 3: Add the parameterized type predicate** for either supported value; retain search escaping and ordering. Reject unsupported types in Python consistently with its validation boundary.
- [ ] **Step 4: Run** the Task 7 command and gateway route-policy tests. Expected existing district/login flows remain unaffected.
- [ ] **Step 5: Commit** `fix: honor unified district filtering`.

## Task 8: Scope popular tags to their district

**Files:** Modify `Python/routers/stats.py:6-15,45-75`; create `tests/test_district_statistics.py`.

**Interfaces:** `get_top_tags(cur, limit: int=5, district_id: int|None=None) -> list[dict]`; `district_stats` passes its district ID, `stats_overview` omits it.

- [ ] **Step 1: Add `test_district_top_tags_exclude_other_districts`.** With Math only in district A, empty B has `topTags == []`; B's Chemistry request affects only B; a tied count orders by tag ID. Assert global totals still combine both districts.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_district_statistics.py -q`. Expected empty B incorrectly shows A's Math count.
- [ ] **Step 3: Replace the per-tag counting loop** with one grouped join over tags/request_tags/requests, optional district condition, positive-count results and specified stable order. Keep the existing response fields.
- [ ] **Step 4: Run** the Task 8 command and the normal stats HTTP smoke. Expected independent local counts and correct global aggregate.
- [ ] **Step 5: Commit** `fix: calculate district-local popular subjects`.

## Task 9: Make reloads and adapter output validation reliable

**Files:** Modify `Python/integration_api.py:50-62`, `Python/api/adapters/probe.py`, `Python/api/adapters/analysis_adapter.py`; create `tests/test_module_reload.py`; extend `tests/test_python_only_adapters.py`.

**Interfaces:** Preserve `_import_student_module(module_name: str) -> tuple[Any|None,dict|None]`, allowlists and error envelopes. One module-level `threading.RLock` protects only invalidate/pop/import. Student DB execution stays outside the lock.

- [ ] **Step 1: Add `test_reload_critical_section_is_serialized`** using controlled import hooks/events to force competing attempts; assert both succeed and the pop/import sequences do not interleave. Supplement with 20 workers/4,000 real analysis imports. Add normalizer tests: malformed numeric ID → `success is False`/`data is None`; valid zero counters and empty arrays → success. Assert imports still observe an edited synthetic module.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_module_reload.py tests/test_python_only_adapters.py -q`. Expected interleaving or escaped ValueError; do not rely only on a probabilistic stress failure.
- [ ] **Step 3: Add the narrow critical section and normalization boundary.** Catch expected TypeError/ValueError/OverflowError from conversion into the existing invalid-output envelope; preserve unexpected exception visibility. Replace truthy fallback selection where it discards valid numeric zero. Do not serialize calls to student functions.
- [ ] **Step 4: Run** the Task 9 command. Assert all futures finish under bounded deadlines, no false import errors and no stale modules or silent fallback numbers.
- [ ] **Step 5: Commit** `fix: serialize lesson reloads and validate adapter results`.

## Task 10: Record future matches transactionally

**Files:** Create `database/migrations/0003_request_events.sql`, `Python/request_events.py`, `tests/test_request_events.py`, `lib/db/src/schema/request-events.ts`; modify `Python/routers/requests.py`, `database/migrations/ledger.json`, `database/schema/{canonical.sql,local-catalog.json,version.json}`, `lib/db/src/schema/index.ts`, `lib/db/test/{schema-tool.test.mjs,schema-version.test.mjs,catalog.integration.test.mjs,drizzle-schema.test.ts,classroom-bootstrap.test.mjs,classroom-restore.test.mjs}`, `ops/seed-classroom.mjs`, `docs/runbooks/database-schema-and-migrations.md`, `docs/runbooks/classroom-release.md`. Inspect `scripts/test-migration-entrypoint.sh` and `lib/db/test/operator-commands-disposable.sh` for tail-version assertions; retain deliberate 0002 historical rehearsal tests.

**Interfaces:** Table/constraints/indexes follow B1 exactly. `record_match_event(cur, request_row: dict) -> None` consumes the updated request row inside the caller's existing transaction; no new connection or commit. Derive mentor identity from request role, insert DB-timestamped event and creation timestamp snapshot. The one marker exposes tracking start independently of the first match.

- [ ] **Step 1: Add `test_match_event_is_atomic_and_role_attributed`.** Both request directions attribute the mentor correctly. Assert one event for one successful Connect, zero for the losing concurrent call, rollback restores request+event, repeated reads/no-op PATCH create none, reopen+rematch adds one, deleting the request retains both events with null FK, and no historical matched rows acquire events. Add migration tests: 0002→new tail preserves all old data, creates exactly one tracking marker, repeated migration execution adds none.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_request_events.py -q` and `pnpm --filter @workspace/db test`. Expected missing table/event contract before the migration is implemented.
- [ ] **Step 3: Add the migration/helper and call it in the locked Connect transaction.** Follow the current ledger generator/introspection procedure; append SQL, capture a disposable catalog and real SHA256 values, update Drizzle and manifest counts from evidence, never guessed constants. Update seeding/snapshots so synthetic DBs retain the real tracking marker and do not backfill fake historical events. Readiness must expect the new tail. Document backup/dry-run/migration-before-code and additive rollback behavior, including pausing Connect writes between migration and the healthy event-writing backend and during any rollback to code without tracking.
- [ ] **Step 4: Run** `pnpm --filter @workspace/db schema:check`, `pnpm --filter @workspace/db test`, `pnpm test:migrations`, and `sh scripts/test-python.sh tests/test_request_events.py tests/test_chat_integration.py -q`. Expected upgrade, clean install, bootstrap/backup/restore and transaction regressions pass with unchanged checksums for 0001/0002.
- [ ] **Step 5: Commit** `feat: record observed mentorship match events`.

## Task 11: Implement honest event-based analytics

**Files:** Modify `Python/analysis.py`, `Python/api/adapters/analysis_adapter.py`, `artifacts/peerbridge/src/pages/Analytics.tsx`, `lib/api-spec/openapi.yaml`; create `tests/test_analysis.py`; extend `tests/test_python_only_adapters.py`, `e2e/learning-surface.spec.ts`; regenerate API clients. Depends on Task 10.

**Interfaces:** Implement `receive_weekly_matches() -> list[dict]`, `receive_most_popular_subject() -> list[dict]`, `receive_mentor_ranks() -> dict`, `response_time_analysis() -> dict` with B2's exact shapes. Private `analysis._utc_now() -> datetime` returns an aware UTC clock value; capture it once per aggregate and parameterize SQL boundaries. Unit/integration function tests patch this clock, without changing the public endpoints. Keep the existing URL while documenting its activity payload and updating the only UI caller.

- [ ] **Step 1: Add `test_analytics_observation_coverage_and_latency`.** Freeze the module clock at `2025-01-20T12:00:00Z` and set the marker to `2025-01-01T12:00:00Z` in an isolated fixture; seed events around Monday/UTC boundaries and preexisting matched requests without events. Assert eight ordered weeks, earlier weeks `matches is None`, boundary coverage partial, tracked empty weeks zero, and unrecorded historical matches never counted. A second case starts tracking exactly at Monday midnight and expects complete coverage to date. Events 2h/4h after creation produce `avgTimeToMatchHours == 3.0`; no events yields null; negative intervals never become negative averages. Include both-role users, both request directions, deleted requests, top-ten tag ties and empty data. Real HTTP tests assert relative current-week behavior without monkeypatching a separate server process.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_analysis.py -q`. Expected missing function/runtime host errors or wrong payload. Browser regression expects the new labels and visible partial/untracked states.
- [ ] **Step 3: Implement parameterized aggregates on canonical tables/events.** Set UTC explicitly in SQL/calculations. Adapt B2 shapes without computing substitute results in adapters. Update chart handling for null gaps/partial weeks, label the current week as week-to-date, and update activity labels; remove the old inferred response percentage and misleading “hours to respond” display. Regenerate documented clients.
- [ ] **Step 4: Run** the Task 11 command, `sh scripts/test-python.sh tests/test_python_only_adapters.py -q`, `pnpm api:contract-test`, `pnpm build:release`, and `pnpm exec playwright test e2e/learning-surface.spec.ts`. Expected real `source: "python"`, successful data, no fallback and no fabricated historical zero/rate.
- [ ] **Step 5: Commit** `feat: derive analytics from observed match events`.

## Task 12: Complete scheduling calculations

**Files:** Modify `Python/scheduling.py`, `Python/api/adapters/scheduling_adapter.py`; create `tests/test_scheduling.py`; extend `tests/test_python_only_adapters.py`, `e2e/learning-surface.spec.ts`.

**Interfaces:** `receive_time_data() -> list[dict]` returns `{slot,count}` unique-user counts; `time_dict(student: dict, teacher: dict) -> list[str]` returns the deterministic valid intersection from C. Keep adapter response fields `topSlots`, `userA`, `userB`, `overlap`.

- [ ] **Step 1: Add `test_scheduling_overlap_and_counts`.** Availability `["Mon 17:00","Mon 17:00","Wed 19:00"]` and `["Wed 19:00","Mon 17:00"]` yields `["Mon 17:00","Wed 19:00"]`, count two users per slot, not duplicate-entry counts. Assert null/missing arrays yield `[]`, bad stored slot `Mon 25:00` is excluded, disjoint lists succeed empty, and unknown user is HTTP 404.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_scheduling.py -q`. Expected hardcoded-host/undefined-variable failures.
- [ ] **Step 3: Use configured reads and a pure overlap function.** Reuse the existing weekly-slot rule; sort by weekday/hour, not alphabetical names. Preserve ordinary string labels without converting them to invented dates/timezones.
- [ ] **Step 4: Run** the Task 12 command, adapter tests, and scheduling browser coverage. Assert both scheduling and analytics popular-time-slot endpoints return real successful data.
- [ ] **Step 5: Commit** `feat: complete scheduling availability calculations`.

## Task 13: Replace reporting/moderation fallback success with real module results

**Files:** Modify `Python/reports.py`, `Python/get_blocks.py`, `Python/api/adapters/reports_adapter.py`, `Python/api/adapters/admin_adapter.py`, `artifacts/peerbridge/src/pages/AdminReports.tsx`; create `tests/test_reporting_modules.py`; extend `tests/test_python_only_adapters.py` and `artifacts/api-gateway/test/public-contract.test.ts`.

**Interfaces:** `signup_summary() -> dict[str,int]`, existing zero-argument daily/monthly/yearly wrappers, `count_blocks(blocks_data: list[tuple[int,int]]) -> dict[int,int]`, `get_flagged_users() -> list[dict]`. Private `reports._utc_now() -> datetime` provides one aware UTC value per summary; pass derived boundaries into the aggregate query. Follow C's UTC semantics and existing public moderation fields; adapter success uses `source: "student-module"`. On module failure return `ok:false`, `data:null`, and an explicit module error, not successful fallback data.

- [ ] **Step 1: Add `test_signup_utc_boundaries_and_real_sources`** with the module clock frozen at `2025-01-01T00:30:00Z`: two users created in the preceding UTC year plus one at `2025-01-01T00:00:00Z` yield `{"today": 1, "thisMonth": 1, "thisYear": 1, "total": 3}`; an empty fixture yields four zeros. Test other month/day boundaries similarly and verify real sources through the gateway using current-relative fixtures. Add `test_flagged_users_real_module_and_redaction`: distinct pair counts, 1/3/5 thresholds, empty list, failure envelope and no email/district leakage through the gateway. Assert the UI says review is recommended, not that a login ban occurred.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_reporting_modules.py -q`. Expected reports syntax error, absent count helper and fallback source mismatch.
- [ ] **Step 3: Repair the module implementations.** Use one signup summary query and call it once per summary request. Move existing moderation SQL into its owning module instead of maintaining two implementations. Retain compatibility count wrappers and explicit failures; clarify threshold labels without introducing automated account suspension.
- [ ] **Step 4: Run** the Task 13 command, adapter tests and `pnpm test:gateway`. Expected working syntax/import, real data for healthy DBs, explicit failures for unavailable DBs and unchanged privacy projection.
- [ ] **Step 5: Commit** `feat: complete signup and moderation reporting modules`.

## Task 14: Supply the missing location lesson

**Files:** Create `Python/locations.py`, `tests/test_locations.py`; extend `tests/test_python_only_adapters.py`, `e2e/learning-surface.spec.ts`; modify `Python/README.md` with the implemented input/output example.

**Interfaces:** `location_data(student: dict, mentor: dict, question: dict) -> dict` consumes existing practice form objects and returns `{compatible: bool, overlap: list[str]}`. No database/network operation.

- [ ] **Step 1: Add `test_location_label_compatibility`.** Existing form example San Jose versus San Jose/Cupertino returns `{"compatible": True, "overlap": ["san jose"]}`. Test trim/casefold/dedup, scalar fallback, no overlap, absent fields and malformed values. Assert the real status route identifies the function and test route returns `success:true` for valid input, including no-overlap.
- [ ] **Step 2: Run** `sh scripts/test-python.sh tests/test_locations.py -q`. Expected module import error.
- [ ] **Step 3: Implement C's deterministic label intersection.** Raise ValueError for malformed supplied values and retain the existing integration envelope. Do not add geolocation permissions, external calls or an unrequested distance algorithm.
- [ ] **Step 4: Run** the Task 14 command and practice browser test. Expected actual module invocation and accurate positive/negative results.
- [ ] **Step 5: Commit** `feat: complete the location compatibility lesson`.

## Task 15: Integrate and verify mentor Mission 6 once

**Files:** Modify `Python/mentor_ranks.py` only if PR #20 is still absent; verify `tests/test_mentor_ranks.py`; update `docs/STUDENT_MENTOR_RANKS_GUIDE.md` completion commands.

**Interfaces:** Preserve `get_mentor_rank(mentor_id: int, request: Request) -> dict`. Authenticate, validate positive ID, calculate the full ranking, select requested ID, format five public fields, and raise 404 when absent.

- [ ] **Step 1: Recheck PR #20 and run** `MENTOR_RANKS_MODULE=mentor_ranks sh scripts/test-python.sh tests/test_mentor_ranks.py -q`. Baseline expected 41 passes/3 failures; if already merged, expect a full pass and do not reimplement. Keep global rank, ties, zero counts, 401/422/404 assertions.
- [ ] **Step 2: Add any missing composition regression** using real PostgreSQL and the lesson router: list and detail for the same mentor must agree on rank/badge, including zero-match and both-role mentors. Run that focused check before implementation.
- [ ] **Step 3: Integrate the previously reviewed lookup** if needed, without importing the answer key or exposing new production routes. Do not automatically merge another person's PR or close it.
- [ ] **Step 4: Run** default and student-selected rank suites plus a real lesson-server authenticated HTTP check. Expected all student missions pass with no TODO response on the completed routes.
- [ ] **Step 5: Commit remaining task changes** with `feat: complete student mentor rank lookup`; if already integrated and no change is needed, record the verified upstream commit instead of creating an empty commit.

## Task 16: Require end-to-end backend completion before release

**Files:** Create `tests/test_backend_completion.py`, `docs/runbooks/backend-completion.md`; modify `scripts/test-python.sh`, `scripts/verify-release.sh`, `scripts/test-verify-release.mjs`, `.github/workflows/release-surface.yml`, `Python/README.md`, `docs/runbooks/classroom-release.md`, and `e2e/learning-surface.spec.ts`/`e2e/classroom-flow.spec.ts` where the new UI contracts require assertions.

**Interfaces:** Retain existing release entrypoints and branch-scoped Python freeze policy. Add a student-selected rank-suite invocation to the release sequence. `test_backend_completion.py` uses the real Task 1 gateway/server fixtures and completed modules, not mocked success data. Preserve injected failure-envelope unit tests separately.

- [ ] **Step 1: Add `test_completed_backend_flow_through_gateway`.** Register/login synthetic accounts; clear profile; create/page/filter/edit/match/delete requests; verify exactly one event; block and verify recommendations; exercise room/DM persistence and errors; query every learning endpoint with real nonempty and empty fixtures. Assert successful module source/data, no TODO, no adapter-fallback on required happy paths, correct privacy redaction, then logout. Keep real WS coverage in the chat suite. Add `test_active_python_sources_compile`, compiling each repository Python source under `Python/` with `compile(source, path, "exec")` without importing it. Add release-script assertions that the student-selected suite and canonical DB checks cannot silently skip.
- [ ] **Step 2: Run** `node scripts/test-verify-release.mjs` and `sh scripts/test-python.sh tests/test_backend_completion.py -q`. Before Step 3, expect the newly required student-suite invocation check to fail; after Tasks 1–15, the functional completion tests should already pass. Any functional failure is unresolved integration work and blocks the completion claim. Do not loosen assertions merely to accept legacy error envelopes.
- [ ] **Step 3: Wire the gate and update documentation.** Install locked Python/gateway prerequisites before tests, run both default and student rank checks, keep exit-code propagation, and update lesson/reference/runtime status descriptions. Document partial historical analytics, event migration/rollback, 50-message history, legacy oversized-detail inspection, synthetic test prerequisites, single-worker limitation and no production-deployment claim. Do not change unrelated dependency audit policy to get green CI.
- [ ] **Step 4: Run final acceptance:**
  ```sh
  sh scripts/test-python.sh
  MENTOR_RANKS_MODULE=mentor_ranks sh scripts/test-python.sh tests/test_mentor_ranks.py -q
  pnpm --filter @workspace/db test
  pnpm api:contract-test
  pnpm test:gateway
  pnpm build:release
  pnpm exec playwright test e2e/learning-surface.spec.ts e2e/classroom-flow.spec.ts
  pnpm verify:release
  ```
  Expected: all required tests pass with zero skipped database/completion checks; generation is reproducible; migrated DB survives backup/restore; all nine findings have passing regressions. Record exact commands/counts and any independent dependency/tooling failure without calling it success. Read all diffed source with an independent whole-branch reviewer. Do not expose/deploy the server as part of this plan's implementation without the separate release procedure.
- [ ] **Step 5: Commit** `test: require complete backend behavior through the gateway` and hand off the reviewable branch/PR with test evidence and migration instructions.

## Coverage and self-review

| Audited issue / completion requirement | Owning task |
| --- | --- |
| 1. Oversized shared request feed | 1 |
| 2. Blocked recommendations | 2 |
| 3. Concurrent DM starts | 3 |
| 4. Invalid request writes become 500 | 5 |
| 5. Cannot clear bio | 6 |
| 6. Unified district filter ignored | 7 |
| 7. District tags use global counts | 8 |
| 8. Concurrent student imports fail | 9 |
| 9. Unbounded DM history | 4 |
| Explicit user choice: future event tracking, no false history | 10–11 |
| Analytics / scheduling / reports / block helper / locations | 11 / 12 / 13 / 2+13 / 14 |
| Mentor rank Mission 6 | 15 |
| Full server evidence and migration/readiness compatibility | 10+16 |

Self-review completed when drafting: every audit item maps above; the five Review Focus cases have named owning tests; interfaces use one agreed cursor, event table and analytics payload; limits and null/error semantics match the companion design. Tasks specify behavior/tests rather than full function bodies. All execution checkboxes remain unchecked: this is a plan, not a completion report.

## Execution handoff

Review the companion design and this plan before implementation. Recommend **subagent-driven execution**, because changes span safety-related matching, concurrency, a schema migration, public contracts and learning modules; independent gates at each task reduce the cost of carrying a mistake forward. **Native execution** is the less expensive alternative: one implementer follows the same task/test sequence and obtains one independent whole-branch review at the end. No execution method has been selected yet.

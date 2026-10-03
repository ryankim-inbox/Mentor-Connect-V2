# Local Startup and School District Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Python API의 시작 오류를 해결하고, 회원가입 화면에서 실제 School district 목록과 조회 상태를 확인할 수 있게 한다.

**Architecture:** 기존 `Vite :5173 → API gateway :8080 → FastAPI :8181 → PostgreSQL` 구조를 유지한다. 호환되지 않는 DM 코드를 기존 psycopg2 도구에 연결하고, Register 화면은 기존 React Query 결과로 로딩·실패·빈 검색 결과를 표시한다.

**Tech Stack:** FastAPI, psycopg2, PostgreSQL, React, TanStack Query, Vite, pnpm, pytest, Playwright.

**Spec:** 사용자의 2026-10-03 오류 보고와 이 문서의 [설계 기준](#설계-기준). 기존 흐름의 bounded 수정이며, 사용자가 계획 문서를 명시적으로 요청했다. 별도의 아키텍처 변경은 없다.

**Status:** 2026-10-03 사용자 승인 후 Native 방식으로 구현 완료. 관련 백엔드 39개 및 브라우저 26개 테스트 통과, 실제 PostgreSQL을 연결한 브라우저에서 학군 32개 조회·검색·선택 확인. 최종 서브에이전트 검토 완료: 수정 요청 없음. PR 게시 준비 완료.

## Global Constraints

- Python은 기존 `>=3.12` 조건과 프로젝트 `.venv`를 사용한다. 현재 오류를 이유로 Python을 다운그레이드하지 않는다.
- Node는 프로젝트 `.node-version`의 `24.21.0`, pnpm은 `10.33.0`을 사용한다.
- SQLAlchemy, ORM 모델, 새 DB 연결 계층을 추가하지 않는다.
- 기존 `Python/db.py`의 `db()`와 `chat.py`의 인증·참여자 확인·본문 검증·응답 변환 도구를 재사용한다.
- 실제 DB의 학군 32개와 사용자 데이터를 보존한다. 기존 DB에 bootstrap, DROP, legacy fixture, seed를 실행하지 않는다.
- 브라우저 주소는 `http://localhost:5173`; gateway의 `GATEWAY_PUBLIC_ORIGIN`도 정확히 같은 값으로 설정한다.
- `/api`와 `/ws`는 gateway를 통과한다. gateway 우회, 전체 chat router 제외, import 오류 무시는 해결책으로 사용하지 않는다.
- 환경변수의 비밀 값은 문서·로그·커밋에 기록하지 않는다.
- 채팅 Mission 1–6과 학군 조회 API의 경로·응답 형식을 유지한다. 학생 분석 코드와 DB 스키마는 수정 대상이 아니다.

## Review Focus

1. SQLAlchemy가 없는 정상 개발환경에서 전체 FastAPI 앱 import가 성공해야 한다. → Task 1, 기존 startup 회귀 테스트.
2. 비로그인 사용자와 DM 비참여자는 REST/WebSocket에서 메시지를 읽거나 기록할 수 없어야 한다. → Task 1, 인증·참여자 테스트.
3. API가 504를 반환했다가 회복하면 같은 회원가입 화면에서 재시도할 수 있어야 한다. → Task 2, 오류→재시도 브라우저 테스트.
4. 성공한 빈 배열은 API 오류와 구별되고, 검색어를 지우면 선택 가능한 목록이 돌아와야 한다. → Task 2, 빈 결과→검색 초기화 테스트.
5. 선택 후 검색을 바꾸거나 이전 검색 응답이 늦게 도착해도 화면과 제출할 학군 ID가 달라지지 않아야 한다. → Task 2, 선택 초기화·응답 순서 테스트.

---

## 확인된 원인과 증거

2026-10-03 로컬 작업 폴더에서 확인했다.

| 관찰 | 결과 | 의미 |
| --- | --- | --- |
| `Python/main.py` import | `chat.py:454`에서 `ModuleNotFoundError: No module named 'sqlalchemy'` | HTTP 서버가 뜨기 전에 앱 로딩 실패 |
| 기존 `test_backend_starts_with_declared_dependencies` | 동일 오류로 **1 failed** | 자동 재현 가능 |
| `127.0.0.1:8181/api/healthz` | 연결 실패 | Python API가 정상 응답하지 않음 |
| `127.0.0.1:8080/livez` | HTTP 200 | gateway 프로세스는 동작 |
| gateway와 Vite의 `/api/districts?type=high_school` | HTTP 504, `{"error":"upstream_timeout"}` | 현재 UI에 데이터가 도달하지 않음 |
| `Python/.env`가 가리키는 DB 조회 | `high_school` 32개; users/requests 테이블 존재 | 학군 seed 부족이 아님 |
| `routers.districts.list_districts(type='high_school')` 직접 호출 | 32개, 정상 응답 필드 | 현재 DB와 학군 조회 로직은 이 요청을 처리 가능 |

**오류의 연결:** `main.py`가 chat router를 함께 import → chat의 잘못된 의존성 때문에 앱 전체 시작 실패 → 학군 요청이 gateway에서 실패 → `Register.tsx`가 `data`만 읽고 `isError`를 표시하지 않음 → placeholder만 있는 빈 선택창으로 보임.

`sqlalchemy` 설치만으로 끝나지 않는다. `chat.py:461,513`의 `Depends(get_db)`는 정의되지 않은 `get_db`를 참조하며, `Conversation`과 `DMMessage` 모델도 없다. 코드가 기대하는 `user1_id/user2_id`와 실제 도구의 `user_a_id/user_b_id`도 다르다. DM WebSocket에는 별도로 정의되지 않은 `get_current_user_from_ws`, `get_conversation_participants`, `manager` 참조가 있다. WebSocket 문제는 현재 import 실패와 구분되는, 같은 DM 코드의 후속 실행 오류다.

## 설계 기준

### 선택지와 추천

1. **추천: 기존 DB 도구로 DM REST/WebSocket 복구.** 이미 있는 `chat_Answer.py`의 해당 메서드와 현재 chat 공통 도구를 참고한다. 새로운 패키지 없이 채팅 의도를 보존한다.
2. **대안: Mission 7–8을 학습용 TODO 응답으로 복원.** 서버 시작만 복구하는 더 작은 변경이지만 DM 기능을 미완성 상태로 되돌린다. 사용자가 이 방향을 선택하면 적용한다.
3. **제외: SQLAlchemy 도입.** 의존성뿐 아니라 세션·모델·스키마 매핑을 새로 만들어야 하므로 이번 문제에 비해 변경 범위가 크다.

### 기대 동작

- 앱 import가 실제 DB 연결 없이도 성공한다. `/api/healthz`는 200으로 응답한다.
- DM REST는 기존 참여자 검증을 거친 후 조회·저장한다. 정상 POST는 201, 빈/공백/2000자 초과 본문은 400이다. 2000자 상한은 trim 이후 적용한다.
- DM 이력은 soft-delete된 행을 제외하며 시간순으로 반환한다. 다른 참여자의 읽지 않은 표시 가능한 메시지만 읽음 처리한다. 본인 메시지의 `readAt`은 조회로 변경하지 않는다.
- WebSocket은 인증·참여자 검증 후 연결하고, 저장된 메시지를 해당 대화의 연결에만 전송하며 종료 시 등록을 해제한다. 기존 room WebSocket 패턴을 유지한다.
- Register의 학군 상태 문구는 다음과 같다: `Loading districts...`, `Couldn't load school districts. Please try again.`, `Retry districts`, `No districts match your search.`, `No school districts are available.`
- 초기 로딩/오류/재조회 중에는 학군 선택과 제출을 막는다. 학군 미선택 상태에서도 제출을 막는다. 조회 실패 시 입력한 이름·이메일·비밀번호는 보존한다.
- 검색어를 변경하면 선택된 `districtId`를 0으로 초기화한다. 기존 검색별 query key를 유지해 늦게 끝난 이전 검색이 현재 결과를 덮지 않게 한다.
- UI 문자열은 기존 앱과 같이 영어로 유지한다. `role="status"`/`role="alert"`, 기존 label, native select를 사용한다.

### 범위 제한

DM WebSocket 정리는 학군 로딩 자체에는 필수가 아니며, 추천안의 'DM 기능 복구' 범위에 속한다. room 이력의 최근 50개 선정이나 동시 DM 생성 경합 등 다른 채팅 이슈는 별도 범위다. 기존 전체 integration suite가 이런 문제를 발견하면 별도로 보고하며 테스트를 삭제하거나 이번 작업에 몰래 포함하지 않는다.

## 파일별 책임

| 파일 | 작업 |
| --- | --- |
| `Python/routers/chat.py` | Mission 7–8의 호환되지 않는 코드와 관련 설명만 수정 |
| `Python/routers/chat_Answer.py` | 기존 참고 구현을 읽기만 함; 파일 전체 복사 금지 |
| `tests/test_chat_missions_1_6.py` | 기존 fake DB/소켓 도구와 Mission 1–6 테스트 재사용; 낡은 7–8 TODO 기대값 교체 |
| `tests/test_chat_integration.py` | 기존 startup·실제 DB/소켓 검증 재사용; 아래 district 실제 HTTP 검증 추가 |
| `artifacts/peerbridge/src/pages/Register.tsx` | query 상태 표시, retry, 선택/제출 상태 처리 |
| `e2e/register-districts.spec.ts` | 학군 로딩·오류·빈 결과·검색·선택 회귀 테스트 신규 추가 |
| `Python/README.md`, `database/README.md` | 로컬 실행 부분을 실제 3개 프로세스/포트와 일치시킴 |

## Task 1: Python 시작과 DM 구현을 기존 DB 방식으로 복구

**Files:** Modify `Python/routers/chat.py:452-552,650-674`; Modify `tests/test_chat_missions_1_6.py:587-610`; Test/Modify `tests/test_chat_integration.py`; Modify the local run sections of `Python/README.md` and `database/README.md`.

**Interfaces:**
- Consumes: `db()` context manager; `_require_user(request: Request) -> int`; `_clean_body(raw: str) -> str`; `_load_conversation_membership(cur, conversation_id: int, user_id: int) -> dict`; `_format_dm_message(row) -> dict`; `_fetch_dm_message(cur, message_id: int) -> dict`.
- Produces: `list_dm_messages(conversation_id: int, request: Request) -> list[dict]`; `send_dm_message(conversation_id: int, body: SendMessageBody, request: Request) -> dict`; `async dm_socket(websocket: WebSocket, conversation_id: int) -> None`.
- Wire contract: `/api/dms/{conversation_id}/messages` GET/POST and `/ws/dms/{conversation_id}` retain their existing paths. Messages retain `id`, `conversationId`, `senderId`, `body`, `createdAt`, `readAt`, with ISO timestamp strings and nullable `readAt`.

- [x] **Step 1: Record the failing startup check.**

  Run `.venv/bin/python -m pytest -q tests/test_chat_integration.py::test_backend_starts_with_declared_dependencies`.
  Expected before repair: FAIL with `ModuleNotFoundError: No module named 'sqlalchemy'`. This was already reproduced while planning; rerun when execution begins to establish the then-current baseline.

- [x] **Step 2: Replace the two stale TODO tests with behavior tests using the existing `patch_db`, `QueryStep`, `request_for`, `FakeWebSocket`, and `STAMP` helpers.**

  Add these assertions in named tests; DB query steps must also verify bound parameters, so a membership bypass or string-interpolated user input fails the tests:

  ```python
  # test_mission_7_requires_authentication, parametrized over GET/POST
  assert exc_info.value.status_code == 401
  # test_mission_7_checks_membership, parametrized over GET/POST and missing/outsider
  assert exc_info.value.status_code == expected  # 404 missing; 403 outsider
  # test_mission_7_reads_visible_messages
  assert result == [chat._format_dm_message(visible_row)]
  # Scripted SELECT includes deleted_at IS NULL and ORDER BY created_at, id.
  # Scripted UPDATE includes sender_id <> caller, read_at IS NULL, deleted_at IS NULL.
  # test_mission_7_sends_validated_message
  assert result['body'] == 'hello'
  assert result['senderId'] == 1
  assert result['conversationId'] == 7
  assert result['createdAt'] == STAMP.isoformat()
  assert result['readAt'] is None
  # test_mission_7_rejects_invalid_body; inputs '', '   ', 'x' * 2001
  assert exc_info.value.status_code == 400
  # test_mission_7_accepts_max_body; input '  ' + 'x' * 2000 + '  '
  assert result['body'] == 'x' * 2000
  # test_mission_8_denies_access; anonymous or missing/outsider conversation
  assert websocket.accepted is False
  assert websocket.close_codes == [expected]  # 4401 anonymous; 4403 missing/outsider
  # test_mission_8_persists_broadcasts_and_cleans_up
  assert websocket.sent_json == [saved_message]
  assert same_conversation_peer.sent_json == [saved_message]
  assert other_conversation_peer.sent_json == []
  assert websocket not in chat.dm_connections.get(7, [])
  ```

  Preserve all Mission 1–6 assertions. Run `.venv/bin/python -m pytest -q tests/test_chat_missions_1_6.py`; the initial collection still fails at the broken import. Do not install SQLAlchemy to make collection pass.

- [x] **Step 3: Add `test_districts_are_available_before_login(chat_server)` to the existing integration file.**

  ```python
  def test_districts_are_available_before_login(chat_server):
      with chat_server() as base:
          anonymous = build_opener()
          status, rows = api(anonymous, base, 'GET', '/api/districts?type=high_school')
          assert status == 200
          assert len(rows) == 32  # existing disposable legacy fixture
          assert all(row['type'] == 'high_school' for row in rows)
          assert all({'id', 'name', 'county', 'type', 'memberCount',
                      'openRequestCount'} <= row.keys() for row in rows)
          status, rows = api(anonymous, base, 'GET',
                             '/api/districts?type=high_school&search=zzzz_no_such_district')
          assert status == 200
          assert rows == []
  ```

  `CHAT_TEST_ADMIN_DSN` must identify a local PostgreSQL role permitted to create disposable databases. Existing `chat_database` creates/drops its own uniquely named DB; never load its legacy fixture into the developer's populated DB. Without the variable this test is skipped, which is not completion evidence.

- [x] **Step 4: Implement the three interfaces in `chat.py` using its existing helpers.**

  Remove the two SQLAlchemy imports, duplicated mid-file FastAPI imports, `Depends(get_db)` parameters and undefined model references. Adapt only the corresponding methods from `chat_Answer.py`. Use parameterized SQL with actual `user_a_id/user_b_id` membership, `ORDER BY created_at, id`, and `deleted_at IS NULL` on history/read-receipt updates. Preserve HTTP 201 on POST. Add `dm_connections: dict[int, list[WebSocket]] = {}` alongside the room registry and reuse `_register`, `_broadcast`, `_unregister` for the DM socket. Remove the undefined WebSocket helper/manager references. Update the file's Mission 7–8 comments to match completed behavior.

- [x] **Step 5: Run targeted backend verification.**

  ```bash
  .venv/bin/python -m pytest -q tests/test_chat_missions_1_6.py
  .venv/bin/python -m pytest -q tests/test_chat_integration.py -k 'backend_starts or districts_are_available or rest_missions or live_messages'
  ```

  Expected: no failures; no skips in the DB-backed selection after the disposable-DB prerequisite is configured. Existing integration checks exercise persistence, real HTTP status codes, privacy and both room/DM WebSockets. The unrelated recent-50 and concurrent-start tests are outside this targeted command; document any separately observed failures honestly.

- [x] **Step 6: Update both README run sections with the exact local commands below and expected health checks.**

  All three terminals start in the repository root. Document Node 24 selection for Node terminals, `Python/.env` requirements, and separate process startup. Replace outdated two-process examples; preserve the database fixture warnings and all existing data.

  ```bash
  # Terminal 1
  .venv/bin/python -m uvicorn main:app --app-dir Python --reload --host 127.0.0.1 --port 8181
  # Terminal 2
  NODE_ENV=development GATEWAY_PUBLIC_ORIGIN=http://localhost:5173 GATEWAY_UPSTREAM_ORIGIN=http://127.0.0.1:8181 PORT=8080 pnpm --filter @workspace/api-gateway dev
  # Terminal 3
  PORT=5173 BASE_PATH=/ pnpm --filter @workspace/peerbridge dev
  ```

  Verify `GET http://127.0.0.1:8181/api/healthz` and `GET http://localhost:5173/api/districts?type=high_school`. Expected: 200 for both, with 32 districts in the current local dataset. Use `/livez` only for gateway liveness; source-mode `/readyz` can remain 503 because deployment metadata/readiness credentials are separate requirements. Existing user-run processes must be reused or deliberately restarted, never killed indiscriminately.

- [x] **Step 7: Review the focused diff and commit this tested deliverable.**

  ```bash
  git add Python/routers/chat.py tests/test_chat_missions_1_6.py tests/test_chat_integration.py Python/README.md database/README.md
  git commit -m "fix: restore Python startup with existing DM database helpers"
  ```

## Task 2: Register 화면에서 학군 조회 상태와 재시도 제공

**Files:** Modify `artifacts/peerbridge/src/pages/Register.tsx:58-64,218-285`; Create `e2e/register-districts.spec.ts`.

**Interfaces:**
- Consumes: existing `useListDistricts({type: 'high_school', search}, options)` returning `data`, `isPending`, `isError`, `isFetching`, `refetch`; existing search-dependent query key.
- Produces: same Register component and registration body shape, with accessible query-state text, a `type="button"` retry action, and consistent `form.districtId` selection.
- No changes to generated clients, gateway policies, district API, or global QueryClient settings.

- [x] **Step 1: Add deterministic browser tests with the existing Playwright route interception pattern.**

  Mock `/api/auth/me` as 401 and `**/api/districts?**` independently. Use a deferred promise for loading and out-of-order responses, rather than arbitrary sleeps. Fixture district: `{id: 1, name: 'School A', county: 'Test', type: 'high_school', memberCount: 0, openRequestCount: 0}`. Fill other registration fields with `Tester`, `tester@school.edu`, `Password123!` before asserting district-dependent submit state.

  | Test name | Exact assertions |
  | --- | --- |
  | `districts show loading before options arrive` | `await expect(page.getByText('Loading districts...')).toBeVisible()`; select and submit disabled until fixture response |
  | `district failure can be retried without losing form data` | 504 → `await expect(page.getByText("Couldn't load school districts. Please try again.")).toBeVisible()`; retry button visible; fields retain values; retry → fixture option visible and error gone |
  | `successful empty results distinguish search from unavailable data` | Empty search + `[]` → `No school districts are available.`; nonempty search + `[]` → `No districts match your search.`; neither renders the failure alert |
  | `clearing search restores options and permits selection` | Fill search with unmatched value, then clear; `await expect(page.getByRole('option', {name: 'School A (Test County)'})).toHaveCount(1)`; select ID 1; `await expect(page.getByRole('button', {name: 'Create account'})).toBeEnabled()` |
  | `changing search clears a previous district selection` | Select ID 1, change search; `await expect(page.getByLabel('District choices')).toHaveValue('')`; submit stays disabled until a new selection |
  | `late search responses cannot replace current choices` | Hold search A response, complete search B, then release A; B option remains, A option absent; submit disabled without a current selection |

  Intercept registration and count requests in disabled-state tests: `expect(registerCalls).toBe(0)`. Retry must not submit the form. For a background refresh failure after previously loaded data, assert stale options cannot still be selected while the error is shown.

- [x] **Step 2: Build the current browser test target and observe the new tests fail for the missing states.**

  ```bash
  pnpm --filter @workspace/api-gateway build
  pnpm --filter @workspace/peerbridge build
  pnpm exec playwright test e2e/register-districts.spec.ts
  ```

  Expected before repair: missing loading/error/retry/empty-result UI and selection-state assertions fail. `playwright.config.ts` runs a fixture API and dedicated ports, so these tests do not prove the real Python backend starts.

- [x] **Step 3: Implement the states inside the existing Register component.**

  Read `isPending`, `isError`, `isFetching`, and `refetch` from the existing hook. Derive UI state directly; do not duplicate query state in new React state. Error takes precedence over cached results. Use the exact text from the design, `role="status"` for loading/empty results, `role="alert"` for errors, and `type="button"` for Retry districts. Disable select/submit while pending, fetching, or errored, and submit while districtId is zero. Retain the existing submit-time district guard. On search input change set search and reset `districtId: 0`; keep other form fields. Keep the existing query key and native select.

- [x] **Step 4: Rebuild and run the focused frontend checks.**

  ```bash
  pnpm --filter @workspace/peerbridge typecheck
  pnpm --filter @workspace/peerbridge build
  pnpm exec playwright test e2e/register-districts.spec.ts e2e/auth.spec.ts
  ```

  Expected: typecheck/build succeed, new district tests and existing authentication tests pass. Rebuilding is required because the Playwright config serves the built frontend.

- [x] **Step 5: Verify the original screen against the real stack.**

  Open `http://localhost:5173/register`; confirm the actual 32 districts load, text search works, and a selected district is displayed. Confirm a healthy `/api/districts?type=high_school` response in the real stack. The automated intercepted tests supply failure/retry coverage without disrupting the user's running server. Verify that no database reset or new package was needed. Report separately which checks used mock API responses and which used real Python/PostgreSQL.

- [x] **Step 6: Review and commit this tested deliverable.**

  ```bash
  git add artifacts/peerbridge/src/pages/Register.tsx e2e/register-districts.spec.ts
  git commit -m "fix: explain and recover district loading failures during registration"
  ```

## 실행 전 확인

- 구현은 이 계획 검토 후 시작한다. 추천은 **Native**: 기존 코드에 밀접한 두 작업이라 동일 세션에서 순서대로 구현하기 적합하다.
- 실행 시 최신 작업 상태와 해당 경로의 지침을 다시 확인하고, 별도 수정 브랜치/작업 공간 선택은 실행 단계에서 한다. 계획 작성 중에는 브랜치나 제품 코드를 변경하지 않았다.
- `scripts/verify-release.sh`의 Python freeze는 `codex/learning-tasks-21-24`에 한정되어 있다. 이 과거 릴리스 규칙을 피하려고 검사 자체를 제거하지 않는다. 실제 실행 브랜치와 적용 범위를 먼저 확인한다.
- 전체 계획 자체 검토: 사용자 증상 2개는 startup/실제 학군 검증과 UI 오류 상태로 각각 연결했고, Review Focus 5개 모두 테스트를 지정했다. 확인된 사실과 제안, mock 검증과 실제 스택 검증, 이번 범위와 별도 채팅 이슈를 구분했다.

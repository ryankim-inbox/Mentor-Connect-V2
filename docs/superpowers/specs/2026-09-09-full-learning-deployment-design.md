# Mentor Connect 전체 학습 기능 배포 — 재감사와 설계

검토 기준: `98e1b04c292302bd25365ed7db4c5675671df337` (`main`), 2026-09-09 America/Los_Angeles.
범위: 저장소 코드·설정·기존 slice 문서, 로컬 비-Python 검증. 원격 서비스·운영 DB·실제 자격증명은 사용하지 않았다.

## 1. 이번에 합의한 목표

사용자 결정: **매칭·요청·채팅 등 미완성 기능까지 전부 공개하는 과외 학생 연습용 배포**.
기존 `docs/RELEASE_SLICES_NON_PYTHON_01_20.md`의 “축소 범위만 출시” 결론은 이번 제품 목표를 설명하지 않는다.
기존 slice 1–10의 구현을 전부 되돌리지 않고, 기능을 막는 부분만 교체한다.

### Global Constraints

- Backend는 Python을 메인으로 쓴다.
- Python 파일은 절대 수정하지 않는다.
- 모든 기능을 공개한다. Python 미완성은 기능을 다시 숨기는 조건으로 사용하지 않는다.
- Python의 매칭·채팅·인가·DB 업무 로직을 TypeScript, SQL trigger, monkey patch로 대체하지 않는다.
- `Python/**`, 모든 `*.py`, `Python.zip`, 기존 `pyproject.toml`, `requirements.txt`, `uv.lock`은 읽기 전용으로 유지한다.
- 변경은 React/TypeScript/JavaScript, 비-Python 배포 설정·운영 스크립트·DB 운영 SQL·문서로 제한한다.
- gateway만 외부 API/WS 진입점으로 유지하고 Python은 `127.0.0.1:8181`에 둔다.
- 기존 PostgreSQL migration ledger와 `0001`·`0002` migration은 보존한다. merge·startup에서 DB를 자동 변경하지 않는다.
- `minimumReleaseAge: 1440`을 유지한다. 새 서비스·새 업무 백엔드는 추가하지 않는다.
- 이 문서와 계획은 제안이다. 이번 작업에서는 제품 코드 변경·실제 배포·운영 DB 변경을 하지 않는다.

Python 의존성 선언까지 동결하는 것은 “Python은 절대 건드리지 않는다”를 보수적으로 적용한 범위다.
현재 파일을 읽어 별도 빌드 환경에 의존성을 설치하고 기존 Python 서버를 실행하는 것은 허용되지만,
소스 수정·자동 포맷·answer 파일 교체·새 Python 파일 생성은 허용하지 않는다.
동결 대상은 저장소의 Python 소스와 기존 선언 파일이다. 별도 build/runtime 디렉터리에 third-party
Python package를 설치하는 것은 학생의 소스 파일을 변경하는 것으로 보지 않는다.

## 2. 결론과 접근법

**추천: 기존 gateway를 얇은 전송·검증 경계로 유지한 전체 학습 배포.**
화면, REST 48개 operation, WS 2개 endpoint를 연결한다. 인증·세션·입력 크기·Origin 검사와
자격증명 보호는 유지한다. 학생 코드의 실패는 학습 결과로 표시하고 성공 데이터로 바꾸지 않는다.
배포 데이터는 별도 classroom DB의 합성 데이터로 시작하는 것을 기본 운영안으로 삼는다.
현재 공유 DB가 합성 데이터라는 증거는 확보하지 않았으므로 자동으로 그 DB를 배포 대상으로 선택하지 않는다.

| 검토한 방식 | 판단 |
| --- | --- |
| 기존 gateway 확장 + 전체 UI 연결 | 추천. 기존 경계·테스트·배포 구성을 재사용하고 Python은 그대로 실행한다. |
| gateway 제거 + Python 포트 공개 | 작업량은 작지만 현재 세션 검증·프로필 projection·body/timeout 보호도 함께 사라져 채택하지 않는다. |
| 미완성 기능을 TS 백엔드나 DB trigger로 완성 | Python을 메인으로 유지하고 학생 구현을 보존한다는 요구에 어긋나 제외한다. |

“모든 기능 공개”는 모든 메뉴·학습 API를 사용할 수 있다는 뜻으로 적용한다. 기존 로그인 절차를
삭제하거나 다른 사람의 프로필 수정 권한을 주는 것으로 확대 해석하지 않는다. 관리자 보고 화면도
학습 화면으로 복구하되, 이 저장소에 없는 관리자 역할 체계를 새로 만들지 않는다. 로그인한 학습
사용자가 합성 데이터의 보고 결과를 읽게 하고 이메일 등 불필요한 필드는 gateway에서 제거한다.

## 3. 이번에 직접 실행한 검증

기본 도구는 Node `22.23.1`, pnpm `11.9.0`; 기존 `node_modules`는 pnpm `10.33.0`으로 설치되어 있었다.
pnpm 11로 실행하면 자동 dependency 검사 중 `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`로 중단됐다.
설치 디렉터리를 지우지 않고 `/tmp`의 pnpm 10.33.0 실행 shim으로 하위 명령까지 버전을 맞췄다.
아래 통과 결과는 **기존 로컬 의존성 기준**이며 clean Linux 설치 증명은 아니다.

| 검사 | 결과 | 해석 |
| --- | --- | --- |
| `pnpm run typecheck` | 통과 | 현재 TS 전체 타입 검사 |
| `pnpm test:gateway` | 12 + 8 = 20 tests 통과 | 현재의 축소 정책이 동작한다는 증거 |
| `pnpm run test:peerbridge-release` | 통과 | 13개 금지 marker 제거 검사; 전체 공개 완료 증거는 아님 |
| 프론트 build | 통과 | JS 341.83 kB / gzip 108.20 kB; tooltip sourcemap 경고 있음 |
| `node scripts/verify-api-boundary.mjs` | 35 checks 통과 | 로컬 설정·bundle 경계만 검증 |
| `pnpm test:migrations` | 통과 | dry-run와 post-merge 무변경 정책 |
| `pnpm --filter @workspace/db schema:check` | 통과 | schema 0002, 13 tables, 2 migrations |
| `pnpm --filter @workspace/db test` | 기본 실행 실패 | 현재 설치에서 `lib/db/node_modules/.bin/tsx` 없음 |
| DB tests에 기존 gateway의 tsx PATH만 제공 | 26 + 3 + 7 tests 통과, operator checks 통과 | disposable PostgreSQL에서 제약 diff 0, query plan 6/6. 패키지 선언에 tsx는 이미 있으므로 중복 추가하지 않는다. |
| `pnpm run build` | 실패 | mockup-sandbox가 `PORT`를 요구하여 전체 recursive build 중단 |
| `sh scripts/check-secrets.sh` | 실패 | `integrity-tool.test.mjs`, `test-migration-entrypoint.sh`의 테스트용 credential URL literal을 탐지 |
| `sh scripts/test-secret-workflow-policy.sh` | 통과 | workflow 정책 테스트와 실제 스캐너 통과는 별개 |
| `pnpm audit --json` | 55건: critical 11 / high 30 / moderate 12 / low 2 | registry advisory 기준, 영향받는 경로·중복 advisory 포함; 인터넷에서 55개 취약점이 직접 악용된다는 뜻 아님 |
| `pnpm audit --prod --json` | high 1, Drizzle ORM | peerbridge의 React 등도 devDependencies라 이것만으로 브라우저 bundle의 안전성을 판단할 수 없음 |
| Python tests·Python startup | 실행하지 않음 | 로컬 `.env`/공유 DB에 연결하지 않기 위한 감사 범위. 소스 읽기와 hash 비교만 수행 |
| 원격 배포·복구·secret 교체·branch protection | 미확인 | 로컬 성공으로 대체하지 않음 |

추가로 disposable Node upstream과 **현재 빌드된 gateway**를 연결한 재현 결과:

- `Origin: https://cross-origin.invalid`의 login POST가 upstream까지 전달되어 200을 받았다.
  Origin 검사가 없다는 재현이며, 브라우저의 cross-site 공격 성공을 별도로 증명한 것은 아니다.
- register의 422 `detail[].input`에 넣은 canary가 외부 응답에 그대로 남았다.
- unknown path `/api/audit-private-marker`가 `gateway.denied` 로그에 그대로 기록됐다.

검증 로그는 `/tmp/mentor-connect-audit-*.log`, dependency snapshot은
`/tmp/mentor-connect-audit-dependencies*.json`에 남겼다. 이 경로는 임시 진단 자료이며 릴리즈 증빙 저장소가 아니다.

## 4. 우선순위별 감사 결과

P0 = 이번 학습 배포의 공개·기동을 직접 막는 항목. P1 = 공개 전 함께 처리할 신뢰성/노출 문제.
P2 = 과외 사용량에서 실제 필요가 생길 때 처리할 항목. 학생 과제의 기능 미완성은 별도 기록한다.

| ID | 우선순위 | 근거 | 필요한 변경 |
| --- | --- | --- | --- |
| A01 | P0 | `artifacts/peerbridge/src/lib/release-flags.ts:47`, `src/App.tsx:34`, `src/pages/RequestDetail.tsx:23` | 모든 production flag가 false이고 DEV import가 bundle에서 제거됨. 두 층 모두 해제. |
| A02 | P0 | `artifacts/api-gateway/src/gateway.ts:69,261,454` | REST allowlist는 7 operations뿐이며 WS 전부 403. 48 REST + 2 WS를 구체적으로 등록. |
| A03 | P0 | `gateway.ts:540,687,1150`; Python districts/requests/matches/scheduling router | 기존 query 거부·POST/PATCH만 있는 policy로 필터, DELETE, `?limit`, scheduling query가 작동하지 않음. 검증한 query를 upstream에 보존. |
| A04 | P0 | `.github/workflows/release-surface.yml`, `scripts/verify-peerbridge-release-bundle.mjs` | 전체 기능을 연결하면 기존 CI가 실패하도록 설계되어 있음. 차단 증명을 공개·인증·경계 증명으로 교체. |
| A05 | P0 | root `package.json`, `pnpm-workspace.yaml`, `.github/workflows/release-surface.yml` | packageManager/Node 실행 버전 불일치, Darwin 전용 package가 root 필수 devDependency, mockup이 release build에 포함. clean Linux build 확립. |
| A06 | P0 | `Python/database.py:57`, `Python/requirements.txt`, `pyproject.toml`, `requirements.txt`, `uv.lock` | matching은 psycopg v3를 import하지만 root project/lock에는 psycopg2만 있음. 기존 Python/requirements.txt를 읽어 별도 배포 runtime을 만들고 잠금 산출물로 고정. 기존 Python 파일/선언은 수정하지 않음. |
| A07 | P0 | `scripts/migration-entrypoint.mjs:58`, `database/fixtures/legacy-fixtures.json` | 공식 실행기는 dry-run뿐. mock-1000은 legacy-pre-0002이며 배포 금지. 새 classroom DB 초기화와 현재 schema용 소량 fixture 필요. |
| A08 | P1 | `lib/auth-context.tsx:30`, `pages/Login.tsx:25`, `pages/Register.tsx:57` | 로그인/가입 후 `refetch()`를 기다리지 않고 protected route로 이동. 세션 상태 확정 후 이동. |
| A09 | P1 | `components/Navbar.tsx:14`, `components/RequireAuth.tsx:10` | logout 오류를 무시하고 재조회; auth 5xx를 비로그인과 혼동; in-flight 응답이 cache를 다시 채울 수 있음. |
| A10 | P1 | `pages/Settings.tsx:54`; `Python/routers/users.py:67` | 빈 bio를 null로 보내면 Python이 수정을 생략. `""`를 보내 지우기 동작을 맞춤. |
| A11 | P1 | `gateway.ts:1251` 및 위 canary 재현 | raw FastAPI detail/input·unknown raw path가 외부 응답/로그에 남음. 오류 projection·route family 로그로 수정. |
| A12 | P1 | gateway 전체, 위 Origin 재현 | Origin·rate limit 없음. 작은 단일 인스턴스용 경계 통제 추가. 별도 Redis 미도입. |
| A13 | P1 | `lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts` | 28 REST operations와 실제 48 REST가 불일치. cookieAuth 없음. adapter/학습 미완성 응답을 계약에 포함. |
| A14 | P1 | dependency audit snapshot | Orval의 critical 11건은 codegen 경로, Drizzle high는 db tooling 경로. 업데이트 뒤 codegen/DB 검사; 감사 수치만 낮추는 ignore 금지. |
| A15 | P1 | `lib/db/test/integrity-tool.test.mjs:333,355`, `scripts/test-migration-entrypoint.sh:12` | 합성 credential URL literal 때문에 tracked secret gate가 실패. 테스트 의도를 유지하며 fixture 표현 수정. 실제 incident closure와 구분. |
| A16 | P1 | `docs/security/secret-exposure-incident-ledger.md:5` | 과거 secret 교체 6개 항목 미확인. 현재 자격증명을 공개하거나 그대로 배포하지 않고 새 교실 secret 발급 및 기록. |
| A17 | P1 | `Python/main.py:72`, gateway `index.ts`, `.replit` | healthz는 DB를 검사하지 않음. readiness, bounded shutdown, release SHA, 최소 장애 로그 필요. |
| A18 | P1 | `pages/Landing.tsx:26`, `pages/Profile.tsx:49`, `Python/routers/auth.py:63` | `.edu` 문자열만으로 verified student를 표시. 학습 계정 문구로 정정하고 로그인 form label/zoom 개선. |
| A19 | P1 | `.github/workflows/*`, `peerbridge/package.json` | typecheck/gateway/DB/codegen/browser test가 하나의 필수 release 검증으로 연결되지 않음. |
| A20 | P2 | Python requests/districts의 반복 SELECT, chat process-local registry | N+1, pagination, WS multi-instance broadcast는 Python 업무 구현 문제. 이번에는 작은 데이터와 단일 프로세스로 운영하고 과제로 기록. |

## 5. 전체 공개 계약

아래 목록은 `Python/main.py`에서 실제 include하는 router만 읽어 작성했다.
`Python/routers/chat_Answer.py`, `Python/app.py`, legacy `artifacts/api-server/python/**`는 runtime route로 세지 않는다.
`/livez`, 신설 `/readyz`는 gateway 운영 endpoint라 Python의 48개에는 포함하지 않는다.

정책 `public`: 세션 불필요. `session`: gateway가 같은 Cookie로 `/api/auth/me`를 확인.
Python이 가진 요청 작성자·room membership·DM membership 검사는 그대로 Python이 수행한다.

| Method | Path | 정책 | query/body 주의점 |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | public | 기존 `.edu`, role, districtId 계약; JSON |
| POST | `/api/auth/login` | public | JSON; password 72 UTF-8 bytes 상한, silent truncation 금지 |
| POST | `/api/auth/logout` | session | body 불필요 |
| GET | `/api/auth/me` | session response 검사 | 이 경로 자체를 proxy; 재귀 session 검사 금지 |
| GET | `/api/users/{id}` | session | 타인도 최소 profile summary만; email/bio 제거 |
| PATCH | `/api/users/{id}` | session + self | name/bio/subjects만; role 수정 금지 |
| GET | `/api/districts` | public | `type`, `search` |
| GET | `/api/districts/{id}` | session | canonical positive id |
| GET | `/api/tags` | session | query 없음 |
| GET | `/api/requests` | session | `districtId`, `role`, `status`, `tagId` |
| POST | `/api/requests` | session | 기존 CreateRequestBody |
| GET | `/api/requests/{id}` | session | Python 404 보존 |
| PATCH | `/api/requests/{id}` | session | Python author 검사; status enum 검증 |
| DELETE | `/api/requests/{id}` | session | 성공 204, body 없음 |
| POST | `/api/requests/{id}/match` | session | body 없음; Python 결과 그대로 |
| POST | `/api/reports` | session | 기존 CreateReportBody |
| GET | `/api/blocks` | session | 본인 block 목록 |
| POST | `/api/blocks` | session | blockedUserId |
| DELETE | `/api/blocks/{id}` | session | 성공 204 |
| GET | `/api/stats/overview` | public | aggregate |
| GET | `/api/stats/district/{id}` | session | aggregate |
| GET | `/api/matches/{questionId}` | session | `limit` 1–20, 기본 5 |
| POST | `/api/matches` | session | `question_id`, `limit` 1–20 |
| GET | `/api/chat/rooms` | session | Python room policy |
| GET | `/api/chat/rooms/{id}/messages` | session | Python room policy |
| POST | `/api/chat/rooms/{id}/messages` | session | `{body:string}`; Python 201 |
| GET | `/api/dms` | session | Python user-specific list |
| POST | `/api/dms/start` | session | `{toUserId:number}` |
| GET | `/api/dms/{id}/messages` | session | 현재 학습 미완성 응답 허용 |
| POST | `/api/dms/{id}/messages` | session | 현재 학습 미완성 응답 허용 |
| GET | `/api/practice/status` | session | 학생 모듈 상태 |
| GET | `/api/practice/matching/{questionId}` | session | `limit` 1–20, 기본 5 |
| GET | `/api/practice/locations/status` | session | 실패도 학습 결과 |
| POST | `/api/practice/locations/test` | session | JSON object, 16 KiB 이하 |
| GET | `/api/practice/blocks/status` | session | 실패도 학습 결과 |
| GET | `/api/practice/raw/{moduleName}` | session | find_matches / locations / get_blocks 세 이름만 |
| GET | `/api/analysis/status` | session | PyEnvelope |
| GET | `/api/analytics/weekly-matches` | session | PyEnvelope |
| GET | `/api/analytics/popular-subjects` | session | PyEnvelope |
| GET | `/api/analytics/popular-time-slots` | session | PyEnvelope |
| GET | `/api/analytics/mentor-response-rates` | session | PyEnvelope |
| GET | `/api/python-reports/status` | session | 학습 상태 |
| GET | `/api/python-reports/summary` | session | source 표시; Python 기존 fallback 구분 |
| GET | `/api/scheduling/status` | session | PyEnvelope |
| GET | `/api/scheduling/overview` | session | PyEnvelope |
| GET | `/api/scheduling/suggest` | session | `user_a`, `user_b` positive int, 각각 필수 |
| GET | `/api/admin/flagged-users` | session | 학습 보고용 projection; email 제거 |
| GET | `/api/healthz` | public | process health; DB readiness로 오인 금지 |
| WS | `/ws/chat/rooms/{id}` | session + Origin | Python이 방 접근 검사와 frame 처리 |
| WS | `/ws/dms/{id}` | session + Origin | 현재 Python은 학습 메시지 후 close; 그 동작 그대로 |

미등록 경로·잘못된 method·canonical path 우회는 계속 거부한다. unknown/중복 query key도 거부한다.
신규 DB CRUD endpoint, 무제한 `/api/*` proxy, Python docs/파일 다운로드 route는 추가하지 않는다.

## 6. 학습 기능의 실제 현재 상태와 한계

| 항목 | 소스에서 확인한 상태 | 이번 배포의 완료 기준 |
| --- | --- | --- |
| 방 채팅 | `chat.py:311–449,541`에 room 조회/메시지 저장/room WS/DM 생성 구현 | 기존 REST UI로 두 계정이 메시지를 주고받음. gateway WS도 해당 Python endpoint에 연결. |
| DM 메시지 | `chat.py:452,469,581`에 미완성 응답/WS scaffold 잔존 | 메뉴와 API 공개, `status:"todo"`를 학습 상태로 표시. 메시지 영속 성공으로 표시하지 않음. |
| matching | `find_matches.py` 구현 있음. block load 오류를 빈 집합으로 처리하고 verified 필터 없음 | 결과·실패를 그대로 확인. TS에서 ranking/filter/동시성 알고리즘을 복제하지 않음. |
| 요청 ↔ matching | 요청 생성은 requests 테이블, matching 입력은 questions 테이블 | “Question ID” 표기와 합성 question fixture 제공. request id를 question id로 자동 변환하지 않음. |
| Connect | Python이 읽고 검사한 뒤 별도 UPDATE; concurrent match 경쟁 가능 | 단일 학습 동작 검증. 원자적 매칭 보장을 문구로 주장하지 않음. |
| analytics/scheduling | student adapters가 현재 Python 함수 오류를 실패 envelope로 노출 | 실패 상태도 화면에 보이고 재시도 가능. TypeScript가 대체 숫자/시간을 생성하지 않음. |
| 보고/관리자 | Python의 기존 adapter-fallback 존재, 관리자 React 화면은 삭제됨 | 최소 화면 복구, `source`를 실제대로 표시. fallback을 새로 만들거나 학생 코드 완료로 위장하지 않음. |
| 가입 | .edu suffix 검사, is_verified=true 저장; 소유 확인 없음 | 기존 가입 사용 가능. “Verified school accounts” 보장 문구 제거. |
| 세션 | 7일 signed cookie, logout은 브라우저 cookie 삭제 | 새 로그인/실패/로그아웃 흐름 검증. 탈취 cookie 개별 서버 폐기는 Python 변경 없이 완성했다고 주장하지 않음. |

이 한계들은 **전체 학습 공개를 막는 gate가 아니다**. 실제 오류, 학습 미완성, 도메인 결과를 구분해서 기록한다.
원격 DB 연결 불가·로그인 자체 불가·브라우저 bundle 미배포는 학습 미완성과 다르므로 배포 연결 문제로 처리한다.

## 7. 목표 구성과 데이터 흐름

1. Replit의 기존 정적 artifact가 React를 제공한다. 모든 메뉴와 lazy chunk를 production에 포함한다.
2. 브라우저는 같은 origin의 `/api`와 `/ws`로만 요청한다.
3. gateway는 허용 경로/Origin/body 크기/session을 검사하고 Python loopback으로 전달한다.
4. Python이 업무 로직·세션·DB read/write·WS frame을 처리한다.
5. gateway는 error/input/secret 노출을 줄이고 profile/report 응답을 필요한 필드로 투영한다.
6. 프론트는 success, 실제 빈 데이터, HTTP 오류, 학습 미완성, student failure를 구분한다.

기본 교실 규모: 동시에 20명 안팎, 작은 합성 dataset, Python worker 1개와 gateway process 1개.
실제 호스팅에서 단일 인스턴스를 설정할 수 있는지 배포 시 확인한다. 프로세스 간 WS broadcast를
보장하지 않는 현재 코드를 위해 Redis나 새 채팅 서비스를 추가하지 않는다. UI는 이미 있는 5초 REST polling을 사용한다.
WS endpoint는 실습을 위해 공개하되 UI transport 재작성은 하지 않는다.
지속 실행 단일 인스턴스 선택이 필요하면 Replit Reserved VM을 운영 후보로 삼는다.
[Replit publishing 문서](https://docs.replit.com/learn/projects-and-artifacts/replit-deployments)의 배포 유형을 참고한 제안이며 계정 설정을 확인한 사실은 아니다.

## 8. 운영과 검증 설계

- **Secret:** 테스트 literal 수정과 실제 credential 교체는 별개. 새 classroom DB/SESSION_SECRET 사용,
  과거 token 폐기 증빙 업데이트. 파일 삭제나 history 재작성으로 credential 교체를 대신하지 않음.
- **DB:** 기존 runner 재사용. 신규 빈 classroom DB만 bootstrap; 기존 무ledger DB 자동 baseline adoption 금지.
  소량 fixture는 `database/fixtures/classroom.sql`에 별도로 두며 기존 destructive mock dump는 실행하지 않음.
- **Recovery:** 수업 전 백업, 최근 7개 수업 snapshot 보존, 수업 시작 상태로 30분 내 복구를 첫 목표로 제안.
  별도 임시 DB에서 restore와 constraints/schema 비교. 실제 provider 증빙과 elapsed time 기록.
- **Readiness:** gateway liveness와 별도로 Python health + 제한된 read-only DB probe. 학생 모듈 실패는 readyz 실패로 보지 않음.
- **보안:** configured public Origin 비교, 작은 요청 한도·단일 인스턴스 limiter, 보안 header,
  raw path 대신 고정 route family 로그. SameSite만으로 검증을 대신하지 않음.
- **CI:** frozen install, typecheck, production artifact build, gateway/DB/contract/browser tests,
  secret scan, dependency report, Python freeze를 하나의 release 실행 경로에 묶음.
- **회귀:** 기존 부정 테스트를 삭제하지 않고 unknown route/타인 PATCH/credential leakage/unauthenticated 요청에 재사용.
  이전의 “채팅은 무조건 404” assertion은 “등록된 채팅은 Python으로 전달되고 미등록 경로는 거부”로 변경.

## 9. 검증한 외부 근거

- [Orval maintainer advisory](https://github.com/orval-labs/orval/security/advisories/GHSA-cxq5-97v7-87j8): codegen의 외부/로컬 `$ref` 문제 수정 범위 `>=8.22.0`. 코드 생성 입력도 신뢰 경계로 다룬다.
- [Drizzle maintainer advisory](https://github.com/drizzle-team/drizzle-orm/security/advisories/GHSA-gpj5-g38j-94v9): audit가 지목한 SQL identifier escaping 문제. `>=0.45.2`로 올리고 현재 DB 회귀 검사를 실행한다.
- [uv locking 문서](https://docs.astral.sh/uv/pip/compile/): 기존 requirement 입력을 수정하지 않고 잠긴 runtime 산출물을 만드는 근거.
- [Node 24 HTTP 문서](https://nodejs.org/docs/latest-v24.x/api/http.html): native upgrade·timeout·connection lifecycle을 이용해 WS tunnel을 구현할 수 있다.
- [TanStack Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation): session 전환 시 cancel과 AbortSignal 전파를 함께 검사한다.
- [OWASP Origin 검증](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html): 설정한 target origin을 기준으로 mutation/WS 출처를 비교한다.

## 10. 계획 분할과 추적

마스터: `docs/superpowers/plans/2026-09-09-full-learning-production.md`.
독립적인 검토 단위는 환경·데이터, 공개 API·전송, 사용자 흐름·출시 세 계획으로 나눈다.
대규모 재구성, 전체 포맷, Python legacy 삭제, Kubernetes, Redis, ORM 교체, 별도 backend는 범위에서 제외한다.

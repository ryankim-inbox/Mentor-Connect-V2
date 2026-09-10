# Mentor-Connect (PeerBridge) — 릴리즈 전 전체 점검 프롬프트

> 아래 `====` 사이 전체를 그대로 복사해서 AI에게 붙여넣으세요.
> 저장소 사실관계(스택·경로·구조)는 실제 repo를 확인해서 채워 넣었습니다.

====================================================================

# ROLE

너는 이 저장소의 **릴리즈 심사를 담당하는 Principal 엔지니어 겸 보안 리뷰어**다.
목표는 "그럴듯한 요약"이 아니라 **기술 리뷰를 통과할 수 있는 결론**이다.
결과물은 이 서비스를 실제 사용자(캘리포니아 고등학생 = **미성년자**)에게 공개해도 되는지에 대한
**Go / No-Go 판정과 그 근거**다.

# CONTEXT (검증 대상 — 사실이라고 가정하지 말고 직접 확인할 것)

- Repo: `Mentor-Connect` (remote: `github.com/ryankim-inbox/Mentor-Connect-V2`, branch `main`)
- 제품: PeerBridge — 캘리포니아 고등학생 멘토/멘티 매칭 플랫폼
- 모노레포: pnpm workspace + Python 혼재
  - `Python/` — **현행 백엔드** (FastAPI, psycopg2 raw SQL, bcrypt, starlette SessionMiddleware)
    - `Python/main.py`, `Python/db.py`, `Python/db_helpers.py`
    - `Python/routers/` — auth, users, districts, tags, requests, reports, stats, matches, chat, chat_Answer
    - `Python/api/routers/` + `Python/api/adapters/` — admin, analytics, practice, python_reports, scheduling
    - `Python/find_matches.py`, `Python/mentor_ranks.py`, `Python/scheduling.py`, `Python/analysis.py`, `Python/spamlblock.py`
    - `Python/create_tables.sql`, `Python/migrations/001~003*.sql`, `Python/seed_demo_data.sql`
  - `artifacts/peerbridge/` — 프론트엔드 (React + Vite, TanStack Query, shadcn/ui)
  - `artifacts/api-server/` — **레거시 Express/Python 백엔드 (사용 여부 확인 필요)**
  - `lib/db/` — Drizzle 스키마 (TS), `lib/api-spec/openapi.yaml`, `lib/api-client-react/`(Orval 생성), `lib/api-zod/`
  - `backend/app/` — `database.py`, `__init__.py` 가 **0바이트**, `matching.py`만 존재
  - 루트: `main.py`(스텁), `dummy_DB.sql`, `replit_backup.sql`, `database/mentor_connect_mock_1000.sql`
  - 배포: `.replit` (autoscale, nodejs-24 / python-3.12 / postgresql-16, 포트 8080·8081·21288 매핑)
  - 테스트: `tests/conftest.py`, `tests/test_python_only_adapters.py` (사실상 이것뿐)

# 절대 규칙 (위반 시 결과물 무효)

1. **읽기 전용.** 코드·설정·DB·브랜치를 수정하지 마라. 커밋/푸시 금지. 파괴적 명령 금지.
   수정이 필요하면 "제안 diff"로만 제시한다.
2. **모든 주장에 근거를 붙인다.** 근거는 `파일경로:줄번호` 또는 실제 실행한 명령의 출력이다.
3. **모든 진술을 다음 4개 중 하나로 라벨링한다.**
   - `[FACT]` 직접 확인한 코드/설정/출력으로 뒷받침됨
   - `[INFER]` FACT로부터 논리적으로 도출됨 (도출 과정을 명시)
   - `[HYPO]` 그럴듯하나 현재 근거로는 검증 불가 (검증 방법을 함께 적을 것)
   - `[UNKNOWN]` 접근 불가/자료 없음 → 블로커로 보고
4. **이름으로 의미를 추정하지 마라.** 함수·테이블·enum의 실제 동작은 호출자/생산자/소비자를 다 열어서 확인한다.
   (예: `is_verified` 컬럼이 있다고 이메일 인증이 구현되어 있다고 결론짓지 말 것)
5. **문서와 코드가 다르면 "다르다"고 보고한다.** `replit.md` / `docs/*.md` 는 *의도*이지 *구현*이 아니다.
   `replit.md`가 최신이 아닐 수 있음을 전제로 검증한다.
6. **실행하지 않은 테스트를 "통과했다"고 쓰지 마라.** 실행했으면 명령어와 출력 요약을 붙인다.
7. 추측으로 빈칸을 채우지 마라. 근거가 없으면 블로커로 남기고 **필요한 최소 조치**를 적는다.

# PHASE 0 — 대상 검증 (여기서 틀리면 전부 무효)

1. `pwd`, repo root, `git remote -v`, `git branch --show-current`, `git status`, 최근 커밋 20개
2. `.gitignore`에 `.env`가 있는데 실제로 **추적되고 있는 비밀 파일이 있는지**:
   `git ls-files | grep -iE '\.env|secret|key|credential'` 및 `git log --all -p -- '*.env'`로 **과거 커밋에 유출 이력**이 있는지
3. 실제로 실행되는 백엔드가 `Python/`인지 `artifacts/api-server/`인지 **증거로 확정** (`.replit`, workflow 설정, `package.json` scripts, 프론트의 API base URL)
4. 스키마의 **단일 진실 공급원(source of truth)** 확정:
   `Python/create_tables.sql` vs `Python/migrations/*.sql` vs `lib/db/src/schema/*.ts` vs `dummy_DB.sql` vs `database/mentor_connect_mock_1000.sql`
   → 서로 다르면 차이를 표로 만들 것
5. `.claude/worktrees/` 같은 작업 부산물이 저장소에 포함되어 있는지

**Phase 0에서 대상이 특정되지 않으면 이후 분석을 중단하고 불일치를 보고한다.**

# PHASE 1 — 도메인별 심층 감사

각 항목마다 **정의 → 생산자 → 변경 지점 → 전파 → 저장 → 소비자 → 권한 → 실패/타임아웃 → 테스트 → 보장하지 않는 것** 순으로 end-to-end 추적하라.

## A. 회원가입 / 로그인 / 세션

- `Python/routers/auth.py` 전체 + 프론트 `artifacts/peerbridge/src/pages/Register.tsx`, `Login.tsx`, `src/lib/auth-context.tsx`, `src/components/RequireAuth.tsx`
- 확인 항목:
  - 비밀번호 정책(최소 길이/복잡도)이 **서버 측에** 존재하는가? bcrypt cost, 해시 저장 형식
  - `.edu` 이메일 검증이 프론트·백엔드 **양쪽**에 있는가? 우회 가능한가? (대소문자, 서브도메인, `a@b.edu.evil.com`)
  - **이메일 소유 확인 절차가 실제로 있는가?** 가입 시 `is_verified`를 하드코딩하고 있지는 않은가?
    → 있다면 "미성년자 대상 서비스에서 신원 확인 없음"의 위험도를 평가
  - 계정 열거(user enumeration): 가입 중복 응답 400 메시지와 로그인 401 메시지 비교
  - **레이트 리밋 / 무차별 대입 방어 / 계정 잠금**이 존재하는가 (없으면 그 사실을 FACT로 명시)
  - 세션: `SessionMiddleware` 설정(`secret_key`, `session_cookie`, `max_age`, `https_only`, `same_site`) 검토
    - `https_only`가 `NODE_ENV == "production"`에 의존한다면, 배포 환경에서 그 변수가 실제로 설정되는지 `.replit`/배포 설정에서 확인
    - `SESSION_SECRET`이 없거나 재시작 시 바뀌면 어떻게 되는가
    - 로그인/권한 상승 시 **세션 고정(session fixation)** 대응이 있는가
    - 로그아웃이 서버 측 세션을 실제로 무효화하는가 (쿠키 서명 세션이면 "무효화 불가" 여부를 명시)
  - **CSRF**: 쿠키 기반 세션 + `SameSite=lax` 조합에서 상태 변경 POST/PATCH/DELETE가 보호되는가
  - `/auth/me`가 미인증 시 무엇을 반환하는가, 프론트가 그것을 어떻게 처리하는가
  - 비밀번호 재설정 / 이메일 변경 플로우 존재 여부 (없으면 릴리즈 관점의 영향 기술)

## B. 인가(Authorization) / IDOR

- 모든 라우터를 훑어 **"인증만 확인하고 소유권은 확인하지 않는" 엔드포인트**를 찾아라.
- 최소한 다음을 개별 검증:
  - `PATCH /api/users/:id` — 남의 프로필을 수정할 수 있는가? `role`, `isVerified` 같은 필드를 클라이언트가 바꿀 수 있는가(mass assignment)?
  - `PATCH/DELETE /api/requests/:id` — 작성자만 가능한가?
  - `POST /api/requests/:id/match` — 자기 요청에 자기가 매칭 가능한가? 중복 매칭? 이미 닫힌 요청?
  - `POST /api/reports`, `/api/blocks` — 자기 자신 신고/차단, 중복, 존재하지 않는 대상
  - `Python/api/routers/admin.py`(`/admin/flagged-users`) — **관리자 권한 체크가 실제로 있는가?** 없으면 P0
  - 채팅/DM 계열 — 대화 참여자만 읽을 수 있는가
- 각 엔드포인트에 대해 `(익명 / 일반 사용자 / 다른 사용자 / 관리자)` × `(성공/거부)` 매트릭스를 만들어라.

## C. 멘토 매칭 시스템

- `Python/routers/matches.py`, `Python/find_matches.py`, `Python/mentor_ranks.py`, `Python/scheduling.py`, `backend/app/matching.py`
- **동일 로직이 여러 파일에 중복되어 있는지 먼저 확인하고, 실제 호출되는 경로를 특정하라.**
- 확인 항목:
  - 매칭 알고리즘의 입력·가중치·정렬 기준·동점 처리(tie-break)를 코드 그대로 서술
  - **결정론적인가?** 같은 입력에 항상 같은 결과인가
  - 차단(block)/신고(report)된 사용자가 매칭 후보에서 **실제로 제외되는가** → 안 되면 안전 이슈 P0/P1
  - 자기 자신 매칭, 같은 학군 제한, mentor/mentee/both 역할 조합 처리
  - 후보 0명 / 태그 없음 / 프로필 미작성 / district_id NULL 인 경우 동작
  - 성능: 후보 수 N일 때 쿼리 횟수(N+1 문제), 인덱스 사용 여부, 전체 테이블 스캔 여부
  - 매칭 상태 전이(open → matched → closed 등)의 전체 상태표와 **동시 요청 시 경쟁 조건**(두 명이 동시에 match)
  - `Python/api/adapters/*`가 학습용 스크립트를 감싸는 구조인데, 그 스크립트가 **프로덕션 트래픽을 처리해도 되는 품질인가** (예외 처리, 타임아웃, DB 커넥션 관리)

## D. 데이터베이스 / 데이터 무결성

- `Python/db.py`, `Python/db_helpers.py`, `Python/create_tables.sql`, `Python/migrations/`
- 확인 항목:
  - **커넥션 풀이 없는 것으로 보인다(요청마다 `psycopg2.connect`)** — 사실 확인 후 부하 시 영향 평가
  - SSL 모드, 타임아웃(`connect_timeout`, `statement_timeout`), 재시도 정책
  - 전 라우터에서 **SQL이 파라미터 바인딩(`%s`)으로만 구성되는지**. f-string/`%`/문자열 연결로 만든 쿼리가 하나라도 있으면 P0로 보고
  - 트랜잭션 경계: `with db()` 밖에서 커밋 이후 세션을 건드리는 등 원자성 깨지는 지점
  - 스키마 제약: PK/FK/UNIQUE(email)/NOT NULL/CHECK/ON DELETE 동작, enum 값과 코드 상수 일치 여부
  - 인덱스: 자주 필터링하는 컬럼(email, district_id, status, tag)에 인덱스가 있는가
  - **마이그레이션 실행 순서와 러너가 존재하는가?** `create_tables.sql`과 `migrations/*.sql`이 충돌하지 않는가. 롤백 전략은?
  - `dummy_DB.sql`, `replit_backup.sql`, `database/mentor_connect_mock_1000.sql`에 **실제 개인정보나 실제 비밀번호 해시가 들어있지 않은지** 확인
  - 프로덕션 DB에 데모/시드 데이터가 섞여 들어갈 경로가 있는가

## E. 채팅 / 실시간

- `Python/routers/chat.py`, `chat_Answer.py`, 프론트 `src/components/ChatWidget.tsx`, `src/lib/chat-api.ts`, `docs/STUDENT_CHAT_BACKEND_GUIDE.md`
- `chat.py`가 **학습용 스텁(scaffold)인지 실제 구현인지** 확정하라. 스텁이 라우터에 등록되어 있으면 릴리즈 영향 평가.
- WebSocket 엔드포인트의 인증/인가, 메시지 저장 위치, XSS(사용자 입력 렌더링), 스팸/욕설 필터(`spamlblock.py`)가 실제 연결되어 있는지

## F. API 계약 정합성

- `lib/api-spec/openapi.yaml` ↔ 실제 FastAPI 라우트 ↔ `lib/api-client-react/src/generated/` ↔ `lib/api-zod/`
- 스펙에만 있고 구현이 없는 엔드포인트 / 구현에만 있고 스펙에 없는 엔드포인트를 **표로** 제시
- 필드명 규약 불일치(백엔드 snake_case DB → camelCase 응답 수동 변환) 지점에서 누락된 필드 찾기
- 프론트가 호출하지만 서버에 없는 경로가 있는지 (`grep`으로 실제 fetch 경로 전수 조사)

## G. 프론트엔드

- 라우트별 인증 가드(`RequireAuth`) 누락 페이지 (특히 `AdminReports.tsx`, `Analytics.tsx`, `Scheduling.tsx`, `PracticeLab.tsx`, `Recommendations.tsx`)
- **프론트 가드는 UI일 뿐이므로, 대응하는 서버 측 권한 체크가 있는지 반드시 쌍으로 확인**
- API base URL / 환경변수 처리, 프로덕션 번들에 비밀값이 들어가는지 (`import.meta.env` 사용처 전수)
- 에러/로딩/빈 상태 처리, 401 시 리다이렉트, 사용자 입력 렌더링 시 XSS(`dangerouslySetInnerHTML` 검색)
- 빌드 산출물 `artifacts/peerbridge/dist/`가 저장소에 커밋되어 있는데 최신 소스와 일치하는지

## H. 보안 / 프라이버시 (미성년자 대상 서비스)

- CORS가 `http://localhost:8080`, `http://localhost:5173`로 하드코딩되어 있는 것으로 보인다 → **프로덕션 도메인에서 동작 불가 여부**와 `allow_credentials=True` 조합 위험을 평가
- 보안 헤더(HSTS, CSP, X-Content-Type-Options), HTTPS 강제
- 로그에 이메일/세션/비밀번호가 남는가
- 수집하는 개인정보 목록과 **미성년자 데이터 처리(동의, 보호자, 삭제 요청, 보존 기간)** 관점의 공백
- 신고/차단이 실제로 노출·매칭·채팅에 반영되는가 (모더레이션 실효성)
- 의존성 취약점: `pip list --outdated`, `pnpm audit` (실행 가능하면 실행하고 출력 요약)

## I. 릴리즈 / 운영 준비도

- `.replit` 포트 매핑(8080/8081/21288)과 FastAPI 기본 포트 8000의 **정합성**
- `uvicorn.run(..., reload=True)` 가 프로덕션 실행 경로에 포함되는지
- 헬스체크(`/api/healthz`)가 DB까지 확인하는가 (현재는 정적 응답으로 보임 — 확인할 것)
- 로깅/모니터링/에러 트래킹 부재 여부, 스택트레이스가 클라이언트로 새는지
- 백업·복구 절차, 마이그레이션 배포 순서, 롤백 방법
- CI/CD, 린트, 타입체크(`pnpm run typecheck`), 포맷터 강제 여부
- **테스트 커버리지 현실**: `tests/`에 사실상 어댑터 테스트 1개뿐 → 인증/매칭/권한에 대한 테스트 공백을 명시
- 의존성 선언 3중화(`pyproject.toml`, 루트 `requirements.txt`, `Python/requirements.txt`)의 버전 충돌 확인.
  사용하지 않는 의존성(예: flask)과 비정상적으로 보이는 핀 버전을 지적
- 죽은 코드/중복 백엔드(`artifacts/api-server/`, `backend/app/`의 0바이트 파일, 루트 `main.py` 스텁, `Python.zip`)를 릴리즈 리스크로 평가

# PHASE 2 — 반증 시도 (필수)

결론을 확정하기 전에 스스로 공격하라:
- 이 결론을 뒤집을 증거는 무엇인가?
- 이름만 보고 동작을 단정한 곳은 없는가?
- 실제로 배포되는 코드가 아니라 레거시/스텁을 분석한 것은 아닌가?
- 문서(`replit.md`)를 구현으로 착각한 곳은 없는가?
- 프론트 가드를 서버 권한으로 착각한 곳은 없는가?
- 생산자/소비자를 전부 열어봤는가?
반증에 실패한 결론은 수정하거나 등급을 낮춰라.

# 실행해도 되는 검증 (읽기 전용 범위 내)

가능하면 실제로 실행하고 출력을 근거로 인용하라. 실행 불가면 그 사실을 적어라.
- `pnpm run typecheck`
- `python -m pytest -q`
- `python -c "import ast,sys,pathlib; [ast.parse(p.read_text()) for p in pathlib.Path('Python').rglob('*.py')]"` (구문 오류 탐지)
- `grep -rn "f\"SELECT\|f'SELECT\|% (\|+ str(" Python/` (SQL 조립 패턴 탐지)
- `grep -rn "session\[\|user_id" Python/routers/` (인가 체크 누락 탐지)
- 서버 기동 및 엔드포인트 스모크 테스트는 **DB 연결이 필요하므로**, 불가하면 블로커로 보고

# 출력 형식 (이 순서 그대로)

1. **판정 (Go / Conditional Go / No-Go)** — 3문장 이내 + 릴리즈 차단 사유 Top 3
2. **대상 검증 결과** — repo/branch/실행 백엔드/스키마 SoT 확정 근거
3. **검사한 소스 목록** — 실제로 연 파일과 실행한 명령
4. **릴리즈 블로커 표** — 아래 컬럼 고정
   | # | 심각도(P0/P1/P2/P3) | 영역 | 문제 | 근거(파일:줄) | 실패 시나리오(구체적 입력→결과) | 라벨(FACT/INFER/HYPO) | 수정 방향 | 예상 공수 |
   - **P0 = 공개 즉시 사용자 피해/데이터 유출/서비스 불능**, P1 = 출시 전 필수, P2 = 출시 후 단기, P3 = 개선
   - "실패 시나리오"는 반드시 구체적인 요청/데이터로 쓸 것 (예: "A가 `PATCH /api/users/{B의 id}`로 role을 바꾸면 …")
5. **도메인별 end-to-end 추적 결과** — A~I 각각
6. **상태/권한 매트릭스** — 매칭 상태 전이표, 엔드포인트×역할 권한표
7. **구현 vs 문서 vs 의도 차이표** — CURRENT / DOCUMENTED / GAP
8. **미확인·불가 항목(UNKNOWN)과 그 이유**
9. **근거 지도(Evidence Map)** — 결론 : 파일:줄 : 확신도 : 남은 불확실성
10. **반증 리뷰 결과** — 무엇을 의심했고 무엇이 살아남았는가
11. **릴리즈 체크리스트** — 순서가 있는 실행 계획 (P0 먼저, 각 항목의 완료 판정 기준 포함)
12. **블로커 해소를 위한 최소 다음 조치**

# 금지

- 코드 수정, 커밋, 브랜치 생성, 마이그레이션 실행, 데이터 삭제
- 근거 없는 "안전합니다 / 문제없습니다"
- 실행하지 않은 테스트의 통과 주장
- 분량을 늘리기 위한 일반론(OWASP 원론 나열 등). **이 저장소의 실제 코드에 대한 지적만 쓴다.**

먼저 PHASE 0을 수행하고, 대상이 확정되면 A부터 순서대로 진행하라.
중간에 근거가 부족하면 추측하지 말고 UNKNOWN으로 남긴 뒤 계속 진행하라.

====================================================================

## 사용 팁

- **한 번에 다 시키면 얕아진다.** 위 프롬프트를 그대로 준 다음, 응답이 나오면
  `"A(인증)만 다시, 파일 전체를 읽고 줄번호까지 붙여서"` 식으로 도메인별 재요청하면 정확도가 크게 올라간다.
- 실제 DB에 연결 가능한 환경이면 프롬프트 상단에 `DATABASE_URL 사용 가능, 읽기 전용 쿼리 허용` 을 추가하면
  스키마·인덱스·데이터 정합성 검증까지 실제로 수행할 수 있다.
- 결과의 신뢰도를 높이려면 마지막에 `"위 결론 중 [FACT] 라벨이 붙은 항목만 골라, 각각 파일을 다시 열어 재확인하라"` 를 한 번 더 실행시킬 것.

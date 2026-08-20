# 릴리즈 작업 슬라이스 — Python 제외 범위

> **범위**: 프론트엔드(`artifacts/`), 계약·스키마 패키지(`lib/`), 빌드·배포 설정,
> 저장소 위생, SQL 덤프.
> **제외**: `Python/`, `backend/`, `artifacts/api-server/python/`, 루트 `main.py`,
> `Python.zip` 등 모든 Python 소스. 해당 항목은 별도 트랙에서 다룬다.
>
> 기준 커밋: `main` @ `e152bf61` · 작성일 2026-08-19 · **검증 완료 2026-08-19**
> 근거 표기: `파일경로:줄번호` 또는 실행한 명령. 라벨 `[FACT]` / `[INFER]` / `[UNKNOWN]`.

> **검증 이력** — 초안의 모든 주장을 재검토했다. 결과: 6건 확인·강화, 2건 반증되어
> 철회, 줄번호 5곳 정정. 철회한 항목은 [부록 D](#부록-d--검증에서-철회한-주장)에
> 이유와 함께 남긴다. 재작업 방지가 목적이므로 삭제하지 않는다.

---

## 슬라이스 순서 요약

| # | 슬라이스 | 왜 이 순서인가 | 등급 | 예상 공수 |
|---|---|---|---|---|
| 01 | 유출된 비밀정보 폐기 | 다른 작업 중에도 계속 유효하게 노출된다 | P0 | 1–2h |
| 02 | 프로덕션 빌드·배포 경로 복구 | 이게 안 되면 어떤 수정도 배포할 수 없다 | P0 | 0.5–1d |
| 03 | 파괴적 스키마 도구 차단 | 명령 한 줄로 운영 DB가 소실될 수 있다 | P0 | 2h |
| 04 | 관리자 화면 접근 통제 | 미성년자 모더레이션 데이터가 전원에게 열려 있다 | P1 | 0.5d |
| 05 | 인증 상태·에러 처리 정리 | 04의 가드가 오작동 없이 동작하려면 선행 필요 | P1 | 2–3h |
| 06 | API 계약 정합화 | 계약 공백이 곧 인증 공백이었다 | P1 | 1d |
| 07 | CI 게이트 도입 | 01–06의 회귀를 막는 유일한 수단 | P1 | 0.5d |
| 08 | 의존성 위생 | 릴리즈 번들 축소 + 취약점 정리 | P2 | 0.5d |
| 09 | 죽은 코드·저장소 정리 | 오작업 사고의 원인 제거 | P2 | 0.5d |
| 10 | 포맷터·린트 강제 | 팀 작업 시작 전 고정하는 편이 싸다 | P3 | 2h |

**총 예상**: 4–5일 (Python 트랙과 병렬 진행 가능. 단 슬라이스 02는 Python 트랙의
서버 기동 수정과 통합 지점이 있다.)

---

## Slice 01 — 유출된 비밀정보 폐기

**등급 P0 · 1–2h · 선행 없음 · 다른 모든 작업보다 먼저**

> ### 진행 상태 (2026-08-19)
>
> | 작업 | 상태 | 비고 |
> |---|---|---|
> | `replit_backup.sql` 제거 | **완료** | `git rm` 완료, 미커밋. 참조 0건이라 삭제로 처리 |
> | 자동 검증 도구 | **완료** | `scripts/check-secrets.sh` 신규. 자가검사 포함 |
> | 추적 트리 검증 | **통과** | 343개 파일, 발견 0건 |
> | GitHub PAT 폐기 | **미착수** | 저장소 밖 작업 — 계정 소유자만 가능 |
> | DB 비밀번호 교체 | **미착수** | 저장소 밖 작업 |
> | 계정 2건 비밀번호 변경 | **미착수** | 저장소 밖 작업 |
> | 히스토리 정리 | **보류** | 파괴적 + 원격 영향. 승인 필요 (아래 참조) |
> | `backend/app/matching.py` | **범위 제외** | Python 파일. 실계정 이메일 포함 — 별도 처리 필요 |
>
> **히스토리 오염 범위** `[FACT]` — PAT를 담은 커밋 `7a0d7547`은 **모든 ref에
> 존재한다**: 로컬 13개 브랜치 전부 + 원격 5개(`origin/main`,
> `origin/eric/fix-analysis-connect-comma`, `origin/eric/mock-db-seed-1000`,
> `origin/eric/remove-express-backend`, `origin/HEAD`). `replit_backup.sql`도
> 동일하게 18개 ref 전부에 존재한다. 총 커밋 65개.
> 즉 히스토리 정리는 **저장소 전체 재작성 + 전 브랜치 강제 푸시**를 뜻한다.

### 문제

공개 저장소 git 히스토리와 커밋된 SQL 덤프에 실제 비밀정보가 남아 있다. 커밋에서
지워도 히스토리에 존재하는 한 clone한 누구나 복구할 수 있다.

| 대상 | 위치 | 상태 |
|---|---|---|
| GitHub Personal Access Token | 커밋 `7a0d7547`에 추가 → `88e5e444`에서 삭제 | 히스토리에 잔존 `[FACT]` |
| DB 비밀번호 | 커밋 `0b01711b` (`Python/.env`) | 히스토리에 잔존 `[FACT]` |
| 실계정 이메일 + 완전한 bcrypt 해시 | `replit_backup.sql:419-420` | **현재 HEAD에 존재** `[FACT]` |
| 개발용 세션 시크릿 | 커밋 `618c5632` (`artifacts/api-server/.env`) | 히스토리에 잔존 `[FACT]` |

`replit_backup.sql:419-420`의 두 계정은 `$2b$10$` / `$2b$12$` 해시가 **잘리지 않은
전체 형태**로 들어 있어 오프라인 크래킹이 가능하다.

### 작업

1. GitHub 설정에서 해당 PAT를 **폐기**한다. 스코프·마지막 사용 시각을 먼저 기록해
   오용 여부를 판단한다.
2. DB 비밀번호를 교체한다.
3. `replit_backup.sql`의 두 계정 비밀번호를 변경한다.
4. 위 3건이 끝난 **뒤에** `git filter-repo`로 히스토리를 정리하고 강제 푸시한다.
   협업자가 있다면 재클론을 공지한다.
5. `replit_backup.sql`을 저장소에서 제거하거나 합성 데이터로 대체한다.

> **순서 주의** `[INFER]` 히스토리 정리를 먼저 하면, 정리가 진행되는 동안에도
> 기존 clone과 GitHub 캐시에 토큰이 살아 있다. **폐기가 항상 먼저다.**

### 완료 판정

- [ ] GitHub PAT 목록에서 해당 토큰이 사라졌다
- [x] **추적 트리에 자격증명이 없다** — `sh scripts/check-secrets.sh` 통과 (343파일, 0건)
- [x] **검증 도구가 실제로 탐지한다** — `sh scripts/check-secrets.sh --self-test` 통과
      (양성 6종 탐지 + 합성 덤프 음성 대조)
- [ ] `git log --all -p -- '*.env'`에 비밀값이 남지 않는다 (히스토리 정리 후)
- [ ] `backend/app/matching.py`의 실계정 정보가 정리되었다 (Python 트랙)

### 검증 도구 — `scripts/check-secrets.sh`

추적 파일만 검사한다(무시되는 로컬 `.env`는 대상이 아니다). 6개 규칙:
GitHub 토큰 · AWS 키 · API 키 · 개인키 블록 · 비밀번호가 박힌 접속 문자열 ·
추적되는 `.env` · 실제 해시가 담긴 덤프.

마지막 규칙은 **파일명 허용목록을 쓰지 않는다.** 한 파일 안의 *고유* bcrypt 해시가
2개 이상이면 실제 덤프로 판정한다 — 합성 시드는 자리표시자 해시 하나를 반복
사용하므로 고유 1개다. 덕분에 새 덤프가 추가돼도 자동으로 걸린다.

```
$ sh scripts/check-secrets.sh
추적 파일 343개 검사 중...

통과 — 추적 파일에서 자격증명이 발견되지 않았다.
주의: 과거 커밋은 검사 대상이 아니다.
```

`--self-test`는 각 규칙의 양성 표본을 임시로 만들어 탐지 여부를 확인하고, 고유
해시 1개짜리 합성 덤프가 오탐되지 않는지도 대조한다. **"통과"만 보고 안심하지
않기 위한 장치**이므로 규칙을 수정하면 반드시 함께 돌릴 것.

### 참고 — 문제 없음으로 확인된 항목

- 프론트엔드 번들에 비밀값 없음. `import.meta.env` 사용처는 `App.tsx:98`의
  `BASE_URL` 한 곳뿐이다 `[FACT]`
- `database/mentor_connect_mock_1000.sql`(1000건), `dummy_DB.sql`(300건)은 전부
  합성 `@test.edu` 주소다 `[FACT]`
- `.gitignore:6`이 `.env`를, `:7`이 `.claude/`를 올바르게 제외한다 `[FACT]`

---

## Slice 02 — 프로덕션 빌드·배포 경로 복구

**등급 P0 · 0.5–1d · 선행 없음 · 이후 모든 슬라이스의 검증 전제**

### 문제 1 — 빌드가 환경변수 없이는 실패한다 `[FACT — 실행으로 확인]`

`artifacts/peerbridge/vite.config.ts:7-27`이 설정 평가 시점에 예외를 던진다
(`:9-13`이 `PORT`, `:23-27`이 `BASE_PATH`).

```ts
const rawPort = process.env.PORT;
if (!rawPort) throw new Error("PORT environment variable is required...");
// ...
const basePath = process.env.BASE_PATH;
if (!basePath) throw new Error("BASE_PATH environment variable is required...");
```

실제로 실행해 확인했다.

```
$ env -u PORT -u BASE_PATH pnpm exec vite build --config vite.config.ts
failed to load config from .../artifacts/peerbridge/vite.config.ts
error during build:
Error: PORT environment variable is required but was not provided.
```

`PORT`와 `BASE_PATH`를 설정하는 곳은 `.claude/launch.json:7`의 **개발용 dev 서버
한 곳뿐**이다. `.replit`에도 루트 `package.json`에도 없다. 따라서 깨끗한 배포
환경에서 `pnpm build`는 즉시 실패한다.

`PORT`는 dev 서버에만 쓰이는데(`server.port`) 빌드 경로에서도 필수로 강제된다 —
이것 자체가 설계 오류다.

### 문제 2 — 실행 명령이 정의되어 있지 않다 `[FACT]`

`.replit` 전문에 `[deployment] run`이 없고, `[workflows] runButton = "Project"`에
대응하는 `[[workflows.workflow]]` 블록도 없다. 포트 매핑은 8080/8081/21288인데
프론트 dev는 5173, API는 8000이다.

### 문제 3 — 빌드 산출물을 서빙하는 주체가 없다 `[FACT]`

- `vite.config.ts:58`이 `dist/public`으로 빌드한다
- `vite.config.ts:66-74`의 `/api` 프록시는 `server:` 블록(`:61`) 안에 있어
  **dev 서버 전용**이다. 빌드 결과물에는 프록시가 없다
- 프론트는 상대경로 + `credentials: "include"`로 호출한다
  (`lib/chat-api.ts:59`, `lib/pythonApi.ts:42`)

→ **프론트와 API가 반드시 동일 오리진이어야 한다.** 정적 파일을 서빙하는 주체가
현재 어디에도 정의되어 있지 않다.

### 작업

1. `vite.config.ts`에서 `PORT` 필수 강제를 dev/preview 경로로 한정한다.
   `BASE_PATH`는 기본값 `/`를 둔다.
2. `.replit`에 빌드·실행 명령을 명시하고 포트를 정합시킨다.
3. 동일 오리진 서빙 방식을 확정한다. 선택지:
   - **(a)** FastAPI가 `dist/public`을 정적 마운트 — Python 트랙과 통합 필요
   - **(b)** 리버스 프록시가 `/api`는 백엔드로, 그 외는 정적으로 라우팅
   - 어느 쪽이든 `main.py:39-46`의 CORS 하드코딩(`localhost:8080`, `localhost:5173`)은
     동일 오리진에서 무관해지므로 별도 수정이 필요 없다 `[INFER]`
4. 결정한 방식을 `replit.md`에 기록한다. 현재 `replit.md:69`는
   `cd Python && python main.py`를 안내하는데, 이 경로는 `reload=True`를 켠다.

### 완료 판정

- [ ] 환경변수를 수동 주입하지 않고 `pnpm build`가 성공한다
- [ ] 문서화된 명령 하나로 프론트+API가 동일 오리진에 기동한다
- [ ] 브라우저에서 로그인 → `/dashboard` 진입까지 네트워크 에러 없이 동작한다
- [ ] `artifacts/peerbridge/dist/`가 여전히 커밋되지 않는다
      (현재 0건 — `git ls-files artifacts/peerbridge/dist`)

---

## Slice 03 — 파괴적 스키마 도구 차단

**등급 P0 · 2h · 선행 없음 · 사고 예방이므로 빠를수록 좋다**

### 문제

`lib/db`(`@workspace/db`)는 Drizzle 스키마 패키지인데 **코드에서 import하는 곳이
0건이다** `[FACT — 전수조사]`. 실제 스키마 소유자는 Python 백엔드이고, SoT는
`database/mentor_connect_mock_1000.sql`이다.

> **검증 중 상향** — 초안은 이것을 "잊혀진 고아 패키지"로 봤으나, 사실은 그렇지
> 않다. `replit.md:68`이 이 명령을 **정규 워크플로로 안내하고 있다** `[FACT]`.
>
> ```
> - `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
> ```
>
> 유일한 방어선은 `(dev only)`라는 괄호 주석이고, `drizzle.config.ts:9-11`은
> 환경의 `DATABASE_URL`을 그대로 사용한다. 즉 **아무도 실행하지 않을 죽은
> 스크립트가 아니라, 문서가 실행을 권하는 살아 있는 명령이다.** 위험도가 초안
> 판단보다 높다.

문제는 `lib/db/package.json:12-13`의 스크립트다.

```json
"push":       "drizzle-kit push --config ./drizzle.config.ts",
"push-force": "drizzle-kit push --force --config ./drizzle.config.ts"
```

`drizzle-kit push`는 **DB를 TS 스키마 정의에 맞추도록 변경**한다. 그런데 이 TS
정의는 실제 DB보다 한참 뒤처져 있다.

| 실제 DB (SoT) | `lib/db` Drizzle 정의 | 결과 |
|---|---|---|
| `role CHECK IN ('mentee','mentor','both')` | `text().default("mentee")`, CHECK 없음 | 제약 소실 |
| `location`, `available_times`, `languages`, `grade_level`, `teaching_style` | **없음** | 컬럼 5개 삭제 대상 |
| `questions`, `schedules`, `blocks` | **없음** | 테이블 삭제 대상 |
| `chat_rooms`, `chat_messages`, `dm_conversations`, `dm_messages` | **없음** | 테이블 삭제 대상 |

근거: `lib/db/src/schema/users.ts:6-18`, `lib/db/src/schema/index.ts:1-5`(districts,
tags, users, requests, reports만 export), `database/mentor_connect_mock_1000.sql:67-228`.

`drizzle.config.ts:9-11`은 `process.env.DATABASE_URL`을 그대로 쓴다. 운영 URL이
셸에 로드된 상태에서 `pnpm --filter @workspace/db push`를 실행하면 **7개 테이블과
5개 컬럼이 삭제 대상**이 된다 `[INFER — drizzle-kit push의 문서화된 동작에 근거]`.

### 작업

다음 중 하나를 **결정**한다. 방치가 가장 나쁜 선택이다.

- **(a) 삭제** — 코드 사용처가 0건이므로 가장 단순하다. 타입이 필요하면
  `lib/api-zod`가 이미 OpenAPI에서 생성된 타입을 제공한다
- **(b) 동결** — `push`/`push-force` 스크립트를 제거하고 README에 "타입 참조 전용,
  DB 변경 금지"를 명시한다

어느 쪽을 택하든 **`replit.md:68`의 안내 문구를 함께 제거해야 한다.** 스크립트만
지우고 문서를 남기면 다음 사람이 복원할 근거가 된다.
- **(c) 정합화** — 실제 스키마에 맞춰 Drizzle 정의를 갱신하고 SoT로 승격한다.
  Python 마이그레이션과 이중 관리가 되므로 **권장하지 않는다**

같은 성격의 SQL 측 지뢰도 함께 처리한다: `Python/create_tables.sql`은 이름과 달리
`users` 포함 4개 테이블을 `DROP`한다(`:9-12`). 파일 자체에는 경고가 없고
`Python/migrations/001_practice_additive.sql:16-17` 주석에만 있다.
→ Python 소스는 아니지만 SQL이므로 이 슬라이스 범위다. 파일 상단에 경고를 넣거나
`Python/practice-schema/`로 격리한다.

### 완료 판정

- [ ] 운영 `DATABASE_URL`이 로드된 셸에서 실수로 실행 가능한 파괴적 스크립트가 없다
- [ ] `lib/db`의 처분이 결정되고 README에 기록되었다
- [ ] `create_tables.sql`이 이름만으로 오인될 수 없게 되었다

---

## Slice 04 — 관리자 화면 접근 통제

**등급 P1 · 0.5d · 선행: Slice 05(에러 처리)와 함께 진행 권장**

### 문제 `[FACT]`

`RequireAuth`는 **로그인 여부만** 검사한다. 역할 검사가 없다.

`artifacts/peerbridge/src/components/RequireAuth.tsx:6,10`
```tsx
const { user, isLoading } = useAuth();
if (!isLoading && !user) navigate("/login");
```

`App.tsx:85-87`에서 `/admin/reports`도 동일한 `RequireAuth`로만 감싸여 있다.
`AdminReports.tsx:41,57` 역시 `user` 존재만 확인한다.

→ **로그인한 모든 학생이 모더레이션 대시보드에 진입한다.** 이 화면은
`/api/admin/flagged-users`를 호출하며(`AdminReports.tsx:45`), 응답에는 신고당한
미성년자의 실명·이메일·학군·신고 사유가 포함된다.

프론트 전체에서 **역할 기반 접근 검사는 0건이다** `[FACT — 전수조사]`. `user.role`
사용처는 전부 표시·폼 로직이다(`Dashboard.tsx:78`, `Profile.tsx:51-54`,
`Register.tsx:124-136`, `Settings.tsx:35,131`, `Requests.tsx:49`,
`NewRequest.tsx:94`).

> **검증 중 정정** — 초안은 "Navbar에서 관리자 링크를 숨긴다"를 작업 항목에 뒀으나,
> `Navbar.tsx`에 **관리자 링크 자체가 없다** `[FACT]`. 링크는 dashboard · districts ·
> requests · requests/new · recommendations · practice-lab · analytics · scheduling ·
> profile 뿐이다. 즉 `/admin/reports`는 **URL을 직접 입력해야만 도달**한다.
> 이는 완화 요인이 아니라 위험의 성격이 다를 뿐이다 — 숨겨져 있을 뿐 잠겨 있지
> 않으며, 경로는 `App.tsx`를 읽으면 즉시 드러난다. 해결책은 링크 숨김이 아니라
> 역할 게이트다.

### 선행 확인 사항

프론트 가드는 UI일 뿐이다. `/api/admin/flagged-users`는 **서버에서도 무인증**이므로
(Python 트랙 블로커 #3), 이 슬라이스만으로는 데이터 노출이 막히지 않는다.
**서버측 권한 검사와 반드시 짝으로 배포해야 한다.**

### 작업

1. `RequireAdmin` 컴포넌트를 추가한다. `RequireAuth`를 감싸고 역할을 추가 검사한다.
2. `App.tsx`의 `/admin/*` 라우트에 적용한다.
3. 관리자 역할 표현 방식을 Python 트랙과 합의한다. 현재 스키마의 `role`은
   `('mentee','mentor','both')`뿐이라 **admin 값이 존재하지 않는다**
   (`database/mentor_connect_mock_1000.sql:72`). 별도 컬럼 또는 테이블이 필요하다.

### 완료 판정

- [ ] 일반 학생 세션으로 `/admin/reports` 진입 시 차단된다
- [ ] `AuthUser` 타입에 역할 필드가 있고 `RequireAdmin`이 이를 검사한다
- [ ] 서버측 403과 함께 배포된다 (프론트 단독 배포 금지)

### 참고 — 문제 없음으로 확인된 항목

라우트 가드 **누락은 없다** `[FACT]`. `App.tsx:44-88` 기준 공개 라우트는 `/`,
`/login`, `/register` 3개뿐이고 `Analytics` · `Scheduling` · `PracticeLab` ·
`Recommendations` · `AdminReports` 모두 `RequireAuth`로 감싸여 있다.
문제는 가드의 **강도**이지 존재 여부가 아니다.

---

## Slice 05 — 인증 상태·에러 처리 정리

**등급 P1 · 2–3h · 선행 없음 · Slice 04와 함께 진행**
*(검증에서 문제 2가 철회되어 초안의 0.5d에서 축소)*

### 문제 — 세션 만료와 네트워크 오류를 구분하지 않는다 `[FACT]`

`artifacts/peerbridge/src/lib/auth-context.tsx:30-35, 43`
```tsx
const { data, isLoading, refetch } = useGetMe({
  query: { queryKey: getGetMeQueryKey(), retry: false },
});
// ...
<AuthContext.Provider value={{ user: data ?? null, isLoading, refetch: handleRefetch }}>
```

`useGetMe`가 반환하는 `error`를 **어디에서도 읽지 않는다.** `data`가 없으면 무조건
`user = null`이므로 401(세션 만료)과 네트워크 장애·500이 동일하게 처리되어,
일시적 장애 중에 사용자가 **조용히 로그아웃된 것처럼 보이고** `RequireAuth`가
로그인 페이지로 보낸다.

`retry: false`가 훅 수준(`:33`)과 전역 `queryClient`(`App.tsx:30`) 양쪽에 걸려 있어
일시 장애에 재시도도 하지 않는다.

### ~~문제 2 — 어댑터 응답의 실패를 화면이 신뢰한다~~ — **철회**

초안의 `[INFER]` 추정이었으나 **검증 결과 사실이 아니다.** 어댑터 봉투 처리는
전 계층에서 올바르게 구현되어 있다 `[FACT]`. 상세는 [부록 D](#부록-d--검증에서-철회한-주장).

### 작업

1. `auth-context.tsx`에서 에러 종류를 구분한다. `ApiError.status === 401`일 때만
   비로그인으로 처리하고, 그 외에는 별도 상태로 노출한다.
   `ApiError`는 `custom-fetch.ts:174-200`에 이미 `status`를 담고 있으므로 새로
   만들 것이 없다.
2. `AuthContextValue`(`auth-context.tsx:5-20`)에 인증 실패와 통신 실패를 구분하는
   필드를 추가하고, `RequireAuth`가 후자에서는 로그인으로 보내지 않게 한다.
3. 401 외 장애에는 재시도 또는 명시적 에러 화면을 제공한다.

### 완료 판정

- [ ] API를 내린 상태에서 로그인 사용자가 로그아웃되지 않고 에러 화면을 본다
- [ ] 세션 만료 시에는 정상적으로 로그인 페이지로 이동한다

---

## Slice 06 — API 계약 정합화

**등급 P1 · 1d · 선행: Slice 02(배포 경로 확정)**

### 문제 `[FACT]`

`lib/api-spec/openapi.yaml`은 **22개 경로**를 정의한다. 실제 구현은 **42개 고유
경로**(메서드+경로 쌍으로는 48개)다. 두 집합을 정규화해 차집합을 낸 결과
`[FACT — comm 대조]`:

- **스펙에만 있고 구현이 없는 것: 0개.** 대조 결과 `/healthz` 하나가 나왔으나
  이는 라우터가 아닌 `Python/main.py`에 직접 정의되어 있어 grep 범위를 벗어난
  것으로, 실제로는 구현되어 있다.
- **구현에만 있는 것: 21개.**

| 미문서화 엔드포인트 | 개수 | 서버측 인증 |
|---|---|---|
| `/matches/{id}`, `/matches` | 2 | 없음 |
| `/admin/flagged-users` | 1 | 없음 |
| `/analysis/status`, `/analytics/*` | 5 | 없음 |
| `/practice/*` | 6 | 없음 |
| `/python-reports/*` | 2 | 없음 |
| `/scheduling/*` | 3 | 없음 |
| `/ws/chat/*`, `/ws/dms/*` | 2 | 없음 |

**미문서화 목록과 무인증 목록이 거의 정확히 일치한다** `[INFER]`. 스펙과 생성
클라이언트를 거친 엔드포인트에는 인증이 붙었고, 나중에 직접 추가된 어댑터
라우터들은 그 과정을 건너뛰면서 인증도 함께 누락됐다. 계약 관리의 공백이 그대로
보안 공백이 됐다.

프론트가 이들을 호출하는 방식도 갈라져 있다. 손수 작성한 `fetch` 경로는 **18개**
이며(`pythonApi.ts` / `chat-api.ts`), 스펙 대조 결과 두 부류로 나뉜다 `[FACT]`:

| 부류 | 개수 | 성격 |
|---|---|---|
| 미문서화 + 손수 작성 | 13 | `/admin/*`, `/analytics/*`, `/practice/*`, `/scheduling/*`, `/python-reports/*` — **타입 안전성과 인증 관례를 동시에 벗어남** |
| 문서화됨 + 손수 작성 | 5 | `/chat/rooms`, `/chat/rooms/{id}/messages`, `/dms`, `/dms/start`, `/dms/{id}/messages` — 생성 훅이 **이미 존재하는데 쓰지 않음** |

후자 5개는 스펙에 있으므로 Orval이 이미 훅을 생성해 두었다. 즉 `chat-api.ts`는
**중복 구현**이며, 계약 갱신 없이 바로 교체할 수 있다.

### 생성 파이프라인은 정상이다 `[FACT]`

- `lib/api-spec/orval.config.ts`가 `api-client-react`와 `api-zod` 양쪽을 생성한다
- `openapi.yaml`(2026-07-02 20:45)과 생성물(20:46)의 시각이 1분 차이로 **동기 상태**다
- 즉 문제는 생성물 노후가 아니라 **스펙 자체의 누락**이다

### 작업

1. **먼저** `chat-api.ts`의 5개를 기존 생성 훅으로 교체한다. 계약 변경이 필요
   없으므로 가장 싸고, 나머지 작업의 패턴을 확정한다.
2. 미문서화 19개(WS 2개 제외)를 `openapi.yaml`에 추가한다. 인증 요구사항
   (`security`)을 함께 기술해 계약 자체가 인증을 강제하도록 한다.
3. `pnpm --filter @workspace/api-spec run codegen`으로 재생성한다
   (명령명은 `replit.md:67` 기준 — `generate`가 아니라 `codegen`).
4. `pythonApi.ts`의 손수 작성 fetch를 생성 훅으로 대체한다.
5. WebSocket 2개는 OpenAPI 표현 대상이 아니므로 별도 문서에 기술한다.

### 완료 판정

- [ ] 스펙 고유 경로 수 == 구현 고유 경로 수 (WS 2개 제외 시 40)
- [ ] `pnpm run typecheck` 통과 (현재도 통과 — 회귀 없음 확인용)
- [ ] 프론트에서 손수 작성한 `/api/...` 문자열이 남지 않는다
- [ ] 생성물 재생성 후 `git diff`가 비어 있다 (CI에서 검증 — Slice 07)

---

## Slice 07 — CI 게이트 도입

**등급 P1 · 0.5d · 선행: Slice 02(빌드 성공)**

### 문제 `[FACT]`

- `.github/workflows` 디렉터리가 **없다**
- 타입체크·테스트·감사 중 어느 것도 자동 실행되지 않는다
- 결과적으로 Python 트랙의 `chat.py` SyntaxError가 **2026-07-30부터 3주간**
  아무에게도 감지되지 않은 채 `main`에 남아 있었다

### 현재 상태

| 게이트 | 명령 | 현재 결과 |
|---|---|---|
| 타입체크 | `pnpm run typecheck` | 통과 (3개 프로젝트, 에러 0) |
| 빌드 | `pnpm run build` | 실패 — `PORT` 미설정 (Slice 02) |
| 의존성 감사 | `pnpm audit` | 36건 (high 23) |
| 포맷 | — | 설정 자체 없음 (Slice 10) |

> `pnpm -r build`는 macOS 로컬에서 실행되지 않는 것이 정상이다(플랫폼 바이너리
> 구성상). 로컬 검증은 `pnpm run typecheck`로 하고, 빌드 검증은 CI(Linux)에서 한다.

### 작업

1. `.github/workflows/ci.yml`을 추가한다. PR과 `main` 푸시에서 실행:
   - `pnpm install --frozen-lockfile`
   - `pnpm run typecheck`
   - `pnpm run build` (Slice 02 완료 후)
   - orval 재생성 후 `git diff --exit-code` — 스펙과 생성물의 동기 강제
2. `pnpm audit`는 초기에는 비차단(경고)으로 두고, Slice 08 완료 후 차단으로 승격한다.
3. `main` 직접 푸시를 막고 PR 필수화를 검토한다. 현재 커밋 로그를 보면
   `main`에 직접 푸시하는 흐름과 PR 머지가 섞여 있다.

### 완료 판정

- [ ] PR에서 타입체크·빌드가 자동 실행되고 실패 시 머지가 차단된다
- [ ] 스펙만 수정하고 재생성을 잊은 PR이 CI에서 걸린다
- [ ] `main` 브랜치가 항상 빌드 가능한 상태로 유지된다

---

## Slice 08 — 의존성 위생

**등급 P2 · 0.5d · 선행: Slice 07(CI에서 검증)**

### 문제 1 — 취약점 36건 `[FACT]`

```
$ pnpm audit --audit-level moderate
36 vulnerabilities found
Severity: 2 low | 11 moderate | 23 high
```

확인된 경로는 대부분 `artifacts/mockup-sandbox`의 빌드 체인(postcss 등)이다.
런타임 노출은 제한적이나 **프로덕션 번들 경로 검증이 필요하다**.

### 문제 2 — `mockup-sandbox`가 릴리즈 대상인지 불명 `[UNKNOWN]`

`artifacts/mockup-sandbox`는 `pnpm-workspace.yaml`의 `artifacts/*`에 포함되어
`typecheck`와 `build` 대상이 된다. 이것이 배포 산출물에 포함되는지, 감사 취약점
대부분의 출처인 이 패키지를 릴리즈에서 제외할 수 있는지 확인이 필요하다.
**확인 방법**: Replit 배포 설정의 빌드 범위, `.replitignore` 검토.

### 문제 3 — `dependencies`가 비어 있다 `[FACT]`

`artifacts/peerbridge/package.json`은 `react`, `react-dom`, `wouter`,
`@workspace/api-client-react`를 포함해 **모든 패키지를 `devDependencies`에** 두고
있다. Vite가 전부 번들하므로 현재는 동작하지만, `pnpm install --prod`로 설치하는
환경에서는 빌드가 불가능하다. 런타임 의존성과 빌드 도구를 분리하는 편이 안전하다.

### 작업

1. `pnpm why <pkg>`로 취약점의 런타임 경로 포함 여부를 확인한다.
2. `mockup-sandbox`의 릴리즈 포함 여부를 확정하고, 제외라면 워크스페이스 빌드
   대상에서 분리한다.
3. `peerbridge`의 런타임 의존성을 `dependencies`로 이동한다.
4. `pnpm-workspace.yaml`의 `minimumReleaseAge: 1440`(24h)은 공급망 방어로 유효하니
   유지한다.

### 완료 판정

- [ ] high 등급 취약점이 런타임 번들 경로에 없음을 확인했다
- [ ] `mockup-sandbox`의 릴리즈 포함 여부가 문서에 기록되었다
- [ ] CI의 `pnpm audit`가 차단 게이트로 승격되었다

---

## Slice 09 — 죽은 코드·저장소 정리

**등급 P2 · 0.5d · 선행: Slice 03(lib/db 처분 결정)**

### 문제 `[FACT]`

어느 코드가 살아 있는지 판단하는 데 별도 조사가 필요한 상태다. 이 감사에서도
실행 백엔드를 확정하는 데 `replit.md` · `package.json` 자기기술 ·
`launch.json` 3중 대조가 필요했다.

**이 슬라이스 범위(비 Python)**

| 대상 | 상태 | 처분 |
|---|---|---|
| `lib/db/` | import 0건 | Slice 03의 결정에 따름 |
| `artifacts/api-server/` | `package.json:5`가 스스로 "legacy reference only" 선언 | 삭제 또는 `legacy/`로 이동 |
| `artifacts/mockup-sandbox/` | 릴리즈 포함 여부 불명 | Slice 08에서 확정 |
| `replit_backup.sql` | 2026-04 일회성 덤프, 실계정 포함 | Slice 01에서 제거 |
| `dummy_DB.sql` | 합성 데이터, 사용처 불명 | `database/`로 통합 검토 |
| `scripts/` | `hello.ts` 하나뿐인 스캐폴드 | 유지 또는 삭제 |

> **검증 중 철회** — 초안의 `.pytest_cache/` · `tsconfig.tsbuildinfo` 항목은 불필요
> 하다. 둘 다 이미 추적되지 않는다 `[FACT]`: `*.tsbuildinfo`는 `.gitignore:5`가
> 처리하고, `.pytest_cache/`는 pytest가 디렉터리 안에 자체 `.gitignore`를 생성해
> 스스로를 제외한다. `git ls-files`에 빌드 부산물은 한 건도 없다.

> **범위 밖(Python 트랙)**: `backend/app/`의 0바이트 파일, 루트 `main.py` 스텁,
> `Python.zip`, `artifacts/api-server/python/`. 단 `backend/app/matching.py`는
> 실계정 이메일과 해시 단편을 포함하므로 **Slice 01에서 함께 처리**한다.

### 작업

1. 위 표대로 처분한다. 삭제가 불안하면 `legacy/`로 이동하고 README에 사유를 남긴다.
2. `replit.md`를 갱신한다. 현재 `:13`의 백엔드 기술은 정확하지만 `:69`의 실행
   방법은 `reload=True` 경로를 안내한다.
3. 루트 README에 "살아 있는 코드 경로" 절을 추가한다.

### 완료 판정

- [ ] 신규 참여자가 README만으로 실행 코드 경로를 식별할 수 있다
- [ ] 워크스페이스 빌드 대상에 죽은 패키지가 없다

---

## Slice 10 — 포맷터·린트 강제

**등급 P3 · 2h · 선행: Slice 07(CI)**

### 문제 `[FACT]`

- `prettier`가 루트 `package.json:16`에 devDependency로 있지만
  **설정 파일이 없다**(`.prettierrc` 부재)
- `format` 스크립트도 없다
- ESLint 설정도 없다

즉 포맷터가 설치만 되어 있고 아무 역할을 하지 않는다.

### 작업

1. `.prettierrc`를 추가하고 루트에 `format` / `format:check` 스크립트를 넣는다.
2. 전체 포맷을 **한 번에** 적용하고 단독 커밋으로 분리한다
   (`.git-blame-ignore-revs`에 등록해 blame 오염을 막는다).
3. CI에 `format:check`를 추가한다.
4. ESLint 도입 여부를 결정한다. `react-hooks` 규칙만으로도 가치가 있다.

> **순서 주의** 전체 포맷 커밋은 다른 슬라이스의 diff를 덮어쓴다. **반드시
> 01–09가 머지된 뒤에** 수행한다.

### 완료 판정

- [ ] `pnpm run format:check`가 CI에서 통과한다
- [ ] 포맷 전용 커밋이 `.git-blame-ignore-revs`에 등록되었다

---

## 부록 A — 이 범위에서 "문제 없음"으로 확인된 항목

추측으로 재작업하지 않도록 명시한다. 모두 `[FACT]`.

| 항목 | 확인 방법 | 결과 |
|---|---|---|
| 프론트 라우트 가드 누락 | `App.tsx:44-88` 전 라우트 판독 | 누락 없음 (강도는 Slice 04) |
| 번들 내 비밀값 | `import.meta.env` 전수 조사 | `BASE_URL`(`App.tsx:98`) 한 곳뿐 |
| XSS | `dangerouslySetInnerHTML` 전수 조사 | `ui/chart.tsx:79` 한 곳, 차트 테마 CSS 주입이며 사용자 입력 아님 |
| 타입체크 | `pnpm run typecheck` | 3개 프로젝트 통과, 에러 0 |
| 커밋된 빌드 산출물 | `git ls-files \| grep '/dist/'` | 0건 (`.gitignore:4` 활성) |
| 빌드 부산물 추적 | `git ls-files \| grep -E 'tsbuildinfo\|pytest_cache'` | 0건 |
| Orval 생성물 노후 | 스펙/생성물 mtime 대조 | 동기 상태 (1분 차이) |
| 어댑터 봉투 실패 처리 | 5개 페이지 + `pythonApi.ts` 판독 | 전 계층에서 올바르게 처리 (부록 D) |
| 스펙에만 있는 미구현 경로 | `comm` 차집합 | 0건 |
| `.gitignore` | 내용 확인 | `.env`, `.claude/`, `node_modules/`, `dist/`, `*.tsbuildinfo` 정상 제외 |
| 공급망 지연 정책 | `pnpm-workspace.yaml` | `minimumReleaseAge: 1440` 설정됨 |

## 부록 B — Python 트랙과의 통합 지점

이 문서 범위 밖이지만, 아래 슬라이스는 Python 트랙과 **함께 배포해야** 효과가 있다.

| 슬라이스 | 통합 상대 | 이유 |
|---|---|---|
| 02 | 서버 기동 수정 + 정적 마운트 | 동일 오리진 서빙 주체가 백엔드일 수 있다 |
| 04 | `/api/admin/*` 서버측 권한 검사 | 프론트 가드만으로는 API가 열려 있다 |
| 05 | 어댑터 오류 봉투 정리 | 화면 처리와 응답 형식을 함께 정해야 한다 |
| 06 | 라우터 인증 의존성 추가 | 스펙의 `security`와 구현이 같이 가야 한다 |

## 부록 C — 미확인 항목

| 항목 | 확인 방법 |
|---|---|
| 배포 인스턴스가 실행 중인 커밋 | 배포 URL `/api/healthz` 응답 + Replit 배포 이력 SHA |
| `mockup-sandbox` 릴리즈 포함 여부 | Replit 배포 설정의 빌드 범위 |
| 운영 환경 변수 (`NODE_ENV`, `BASE_PATH`) | Replit Secrets 패널 |
| 유출된 PAT의 유효성·스코프 | GitHub 설정의 PAT 목록 (읽기 전용 감사 범위상 미검증) |

## 부록 D — 검증에서 철회한 주장

초안에서 제기했다가 재검토 후 **사실이 아님을 확인한** 항목이다. 같은 의심이
반복되지 않도록 근거와 함께 남긴다.

### D-1. "화면이 어댑터 실패를 빈 데이터로 렌더한다" — 철회

초안 Slice 05의 `[INFER]` 추정이었다. 실제로는 **모든 계층에서 올바르게 처리된다**
`[FACT]`.

| 계층 | 근거 | 처리 |
|---|---|---|
| fetch 헬퍼 | `pythonApi.ts:45-51` | `!response.ok`면 `detail`을 담아 throw |
| 봉투 판별 | `pythonApi.ts:31-39` | `data`·`source` 필드로 봉투 여부 확인 |
| Analytics | `Analytics.tsx:31` | `if (!envelope \|\| !(envelope.success ?? envelope.ok))` → 실패 렌더 |
| Analytics | `:113, 116, 126` | isLoading / error / `!success` 각각 분기 |
| AdminReports | `:135-139, 174-182` | isLoading / error 분기 |
| AdminReports | `:160-163, 275-278` | `student_module.error`를 화면에 노출 |
| Recommendations | `:164, 269, 278, 410, 444` | `success` 판별 + `.ok` 확인 + 에러 표시 |
| 출처 표시 | `SourceBadge` (`AdminReports.tsx:90, 133`) | 봉투의 `source`를 UI에 노출 |

즉 어댑터가 실패 봉투를 반환하면 화면은 **실패를 실패로 표시한다.** Python 트랙의
어댑터 미완성은 사실이지만, 그것이 프론트 결함으로 이어지지는 않는다.

> **교훈** — "어댑터가 200에 `success:false`를 반환한다"는 사실에서 "화면이 이를
> 놓칠 것"을 추론했으나, 실제 코드는 그 함정을 이미 알고 설계되어 있었다.
> 이름과 구조에서 동작을 추정하지 말 것.

### D-2. "Navbar의 관리자 링크를 숨겨야 한다" — 철회

`Navbar.tsx`에 관리자 링크가 **애초에 없다** `[FACT]`. `/admin/reports`는 URL 직접
입력으로만 도달한다. Slice 04의 문제 자체는 유효하되(역할 검사 0건), 이 작업
항목만 제거했다.

### D-3. "빌드 부산물이 추적되고 있다" — 철회

검증 중 `git ls-files lib | grep dist`가 4건을 반환해 잠시 추적 중으로 판단했으나,
**`dist`가 `district`의 부분 문자열이라 생긴 오탐**이었다. 실제 매칭은
`district.ts` · `districtStats.ts` · `districtType.ts` · `schema/districts.ts`다.
`git ls-files | grep '/dist/'`는 0건이며 `.gitignore:4`가 정상 동작한다.

### 검증으로 **강화된** 항목

| 항목 | 초안 | 검증 후 |
|---|---|---|
| Slice 02 빌드 실패 | 코드 판독 기반 `[FACT]` | **실행으로 재현** — 오류 메시지 인용 |
| Slice 03 `lib/db` 위험도 | "잊혀진 고아 패키지" | `replit.md:68`이 **실행을 권장** — 위험도 상향 |
| Slice 04 역할 검사 | `RequireAuth`만 확인 | 프론트 전체 역할 검사 **0건** 전수 확인 |
| Slice 06 계약 차이 | 개수만 제시 | `comm` 대조로 21건 목록 확정, 손수 fetch 18건을 13+5로 분해 |

---

*이 문서는 읽기 전용 감사 결과다. 코드·설정·DB·브랜치를 수정하지 않았고, 모든
수정 제안은 방향 기술이며 적용되지 않았다. 유일한 실행 부작용은 검증을 위한
`vite build` 시도이며, 설정 로드 단계에서 실패해 산출물을 남기지 않았다.*

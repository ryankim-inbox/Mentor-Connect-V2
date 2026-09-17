# Learning UI and Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 학습 화면을 production에 연결하고 인증·오류 UX와 실제 배포 검증을 완성한다.

**Architecture:** 기존 page와 ChatWidget를 재사용한다. production DEV 분기와 기능 비활성 경계를 제거하고, 같은 origin의 gateway 계약을 사용한다. 기존 REST polling과 학습 미완성 표시를 유지하고 Python 상태를 정직하게 보여준다.

**Tech Stack:** React, Vite, TanStack Query, Wouter, 기존 generated client, node:test, Playwright, GitHub Actions, Replit.

**Spec:** [전체 설계](../specs/2026-09-09-full-learning-deployment-design.md), [마스터](2026-09-09-full-learning-production.md). Task 15–19의 API 인터페이스를 소비한다.

## Global Constraints

- Backend는 Python을 메인으로 쓴다.
- Python 파일은 절대 수정하지 않는다.
- 모든 기능을 공개한다. Python 미완성은 기능을 다시 숨기는 조건으로 사용하지 않는다.
- Python의 매칭·채팅·인가·DB 업무 로직을 TypeScript, SQL trigger, monkey patch로 대체하지 않는다.
- `Python/**`, 모든 `*.py`, `Python.zip`, 기존 `pyproject.toml`, `requirements.txt`, `uv.lock`은 읽기 전용으로 유지한다.
- gateway만 외부 API/WS 진입점으로 유지하고 Python은 `127.0.0.1:8181`에 둔다.
- `minimumReleaseAge: 1440`을 유지한다. 새 서비스·새 업무 백엔드는 추가하지 않는다.

---

## 파일 책임

| 파일 | 책임 |
| --- | --- |
| peerbridge/src/App.tsx / lib/release-flags.ts | 공개 route와 compile-time page 포함 |
| components/Navbar.tsx / pages/Landing.tsx | 전체 학습 기능 navigation·설명 |
| lib/auth-context.tsx / components/RequireAuth.tsx | 단일 session 상태와 인증 전환 |
| lib/pythonApi.ts / lib/chat-api.ts | 기존 교육 payload 계약을 소비하는 fetch wrapper |
| pages/AdminReports.tsx | 삭제된 보고 기능의 최소 학습 화면 |
| e2e/*.spec.ts | 실제 production bundle의 사용자 흐름 |
| scripts/smoke-classroom.mjs | 배포된 실제 Python/gateway의 학습 상태 확인 |
| .github/workflows/release-surface.yml | 전체 release 검증 workflow |

### Task 20: 전체 화면과 navigation을 production에 포함한다

**Files:**
- Modify: `artifacts/peerbridge/src/lib/release-flags.ts`, `src/App.tsx`, `src/components/Navbar.tsx`
- Modify: `src/pages/RequestDetail.tsx`, `src/components/DevelopmentConnectAction.tsx`, `src/pages/Landing.tsx`, `src/pages/Login.tsx`
- Rename: `artifacts/peerbridge/src/components/DevelopmentConnectAction.tsx` → `artifacts/peerbridge/src/components/ConnectAction.tsx`
- Create: `artifacts/peerbridge/src/pages/AdminReports.tsx`, `src/pages/MemberProfile.tsx`
- Modify: `artifacts/peerbridge/vite.config.ts`, `test/release-surface.test.ts`, `scripts/verify-peerbridge-release-bundle.mjs`
- Modify: `artifacts/peerbridge/package.json`, `package.json`, `pnpm-lock.yaml`; Create: `playwright.config.ts`, `e2e/learning-surface.spec.ts`

**Interfaces:**
- 모든 기존 `ReleaseFeature`는 공개 true. 새 release mode 또는 8개의 env toggle 체계를 만들지 않는다.
- `/profile`은 본인 account 화면; `/profile/:id`는 Task 16 ProfileSummary를 소비하는 MemberProfile.
- `/admin/reports`는 로그인 후 학습용 보고 화면, 기존 `/api/admin/flagged-users`와 `/api/python-reports/summary` 사용.
- `pnpm e2e` = `playwright test`; `pnpm --filter @workspace/peerbridge test:unit` = TS node:test 실행.

- [ ] **Step 1 — browser test 최소 도구를 설치한다.** 기존에 browser regression framework가 없으므로
  root에 `@playwright/test` 하나만 exact devDependency로 추가하고 version/lock을 기록한다.
  peerbridge의 TS node tests에는 workspace에서 이미 사용하는 tsx를 direct devDependency로 선언한다.
  Testing Library·Vitest·새 UI framework는 추가하지 않는다.
- [ ] **Step 2 — production bundle을 대상으로 red test를 작성한다.** 로그인된 fixture를 route intercept로 공급하고
  `/register`, `/dashboard`, `/districts`, `/requests`, `/requests/new`, `/recommendations`, `/practice-lab`,
  `/analytics`, `/scheduling`, `/admin/reports`에서 `FeatureUnavailable`이 나타나면 실패한다.
  fixture 실패 payload에도 page 자체와 retry/학습 상태가 보여야 한다. health/실제 Python 검증은 Task 23에 별도로 둔다.
  이 단계의 playwright.config.ts는 `pnpm --filter @workspace/peerbridge serve` 한 개만 시작하며
  PORT=14200, baseURL=http://127.0.0.1:14200, reuseExistingServer=false를 지정한다.
  API는 page.route로 intercept하므로 아직 없는 Task 23 fixture server에 의존하지 않는다.

```ts
const signedInUser = {id:1, name:'Classroom Mentor', email:'mentor@classroom.example.edu',
  role:'mentor', districtId:1, districtName:'Classroom North', bio:'', subjects:['Math'],
  isVerified:false, createdAt:'2026-09-09T00:00:00Z'};
await page.route('**/api/auth/me', route => route.fulfill({json:signedInUser}));
await page.goto('/recommendations');
await expect(page.getByText('Question ID', {exact:true})).toBeVisible();
```

  각 page가 요청하는 다른 API도 spec에 맞는 fixture로 intercept한다. unknown 요청은 테스트를 실패시켜
  의도치 않게 실제 gateway/DB로 나가지 않게 한다.
- [ ] **Step 3 — 모든 DEV-only import를 정상 lazy import로 바꾼다.** 예시와 같은 변경을 App의 기존 모든 page와
  ChatWidget, RequestDetail의 Connect action에 적용한다. `rg 'import.meta.env.DEV|Development'`로 누락을 확인한다.

```tsx
const Recommendations = lazy(() => import('@/pages/Recommendations'));
const PracticeLab = lazy(() => import('@/pages/PracticeLab'));
const ChatWidget = lazy(() => import('@/components/ChatWidget').then(m => ({default: m.ChatWidget})));
const ConnectAction = lazy(() => import('@/components/ConnectAction'));
```

  기존 파일명 DevelopmentConnectAction은 이 task에서 `ConnectAction.tsx`로 rename하고 caller를 같이 바꾼다.
  profile/settings처럼 이미 eager import된 작은 page를 불필요하게 재분할하지 않는다.
  route tree에 하나의 `<Suspense fallback={...}>`를 두어 어떤 lazy route에서도 boundary가 빠지지 않게 한다.
  ReleaseAwareApp의 disabled-route short circuit는 제거하고 정상 AuthProvider/Router를 mount한다.
  기존 caller 호환을 위해 featureFlags는 전부 true로 둔 한 개 literal로 정리한다. 더 이상 쓰이지 않는
  route classifier와 FeatureGate는 실제 reference가 0이 된 것만 삭제한다.
- [ ] **Step 4 — navigation을 복구한다.** Dashboard, Districts, Requests, New Request, Matches,
  Practice, Analytics, Scheduling, Reports, Profile/Settings와 Chat 버튼을 접근 가능하게 한다.
  등록 화면은 로그인 없이 district 목록을 얻어야 한다. 모바일에서는 기존 스타일 + native details/menu로
  같은 링크 배열을 재사용한다. 모든 메뉴를 데스크톱에만 두지 않는다.
  landing/login의 reduced release 문구는 `Explore requests, matching, and chat in this learning app.`으로 바꾼다.
  `.edu`는 가입 형식 조건일 뿐 소유 확인이 아니므로 Verified school accounts/Verified student 문구를 제거한다.
- [ ] **Step 5 — AdminReports를 최소 크기로 복구한다.** Python 업무 계산을 넣지 않는다.

```tsx
type FlaggedUser = {userId:number; name:string; reportCount:number; blockCount:number;
  status:string; lastReportedAt:string|null; topReasons:string[]};
type SignupSummary = {today:number; thisMonth:number; thisYear:number; total:number|null};
const flagged = useQuery({queryKey:['learning','flagged-users'],
  queryFn:() => getPythonApi<FlaggedUser[]>('/api/admin/flagged-users')});
const signups = useQuery({queryKey:['learning','signup-summary'],
  queryFn:() => getPythonApi<SignupSummary>('/api/python-reports/summary')});
```

  두 query의 loading/error/data 상태를 독립 렌더하고 기존 SourceBadge를 사용한다.
  표 column은 Name/Reports/Blocks/Status만. 이름 클릭은 `/profile/{userId}`로 이동한다.
  email이나 raw student_result 출력, 관리 권한 변경 버튼은 추가하지 않는다.
  MemberProfile은 `useGetUser(id)`를 사용하며 positive safe integer만 호출한다. name/subjects/createdAt만 렌더한다.
- [ ] **Step 6 — bundle 검사를 바꾼다.** 이전 `/api/chat`, `/api/requests` 등의 금지 marker만 제거한다.
  hardcoded demo credential/private upstream marker 금지는 유지한다. Vite `build.manifest:true`를 켜고
  manifest의 page/chunk reference가 실제 파일로 존재하는지 검사한다. 단순 endpoint substring 존재를
  “화면 동작” 검사로 사용하지 않는다. 모든 기능의 긍정 검증은 browser test로 한다.
- [ ] **Step 7 — build와 production page tests를 통과시키고 `feat: open all learning screens in production`으로 commit한다.**

### Task 21: 인증 전환과 프로필 저장을 한 흐름으로 맞춘다

**Files:**
- Modify: `artifacts/peerbridge/src/lib/auth-context.tsx`, `src/components/RequireAuth.tsx`, `src/components/Navbar.tsx`
- Modify: `src/pages/Login.tsx`, `src/pages/Register.tsx`, `src/pages/Settings.tsx`
- Remove if unused: `artifacts/peerbridge/src/hooks/use-auth.tsx` (다른 context의 죽은 구현)
- Test: `e2e/auth.spec.ts`

**Interfaces:**

```ts
type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';
interface AuthContextValue {
  user: User | null;
  status: AuthStatus;
  isLoading: boolean; // 기존 caller 호환
  refetch: () => Promise<User | null>;
  logout: () => Promise<void>;
}
```

  User는 generated client의 본인 account 타입을 재사용한다. 별도 중복 field interface를 없앤다.

- [ ] **Step 1 — 실제 race에 대한 browser test를 작성한다.** 로그인 전 GET /auth/me=401을 지연시키고
  로그인 성공 후 GET /auth/me=User를 더 늦게 반환한다. 로그인 후 /login으로 되돌아오면 실패.
  initial auth/me=503은 error/retry 화면이고 /login 자동 이동이 아니어야 한다.
- [ ] **Step 2 — context가 401과 장애를 구분하게 한다.** 401만 anonymous, network/5xx는 error,
  initial pending은 loading, 검증된 User가 있으면 authenticated. background 401에서는 기존 cached User가
  남아 있어도 user=null로 판정한다. RequireAuth는 status별 loading/retry/login/content를 렌더한다.
  로그인 뒤 돌아갈 URL은 local pathname으로만 제한하고 `//`, scheme, `/login`, `/register`는 거부한다.
- [ ] **Step 3 — refetch를 await 가능한 단일 함수로 바꾼다.** generated getMe가 AbortSignal을 소비하는 기존 구조를 유지한다.

```tsx
const refreshSession = async (): Promise<User | null> => {
  try {
    return await queryClient.fetchQuery({
      queryKey: getGetMeQueryKey(),
      queryFn: ({signal}) => getMe({signal}),
      staleTime: 0,
      retry: false,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      queryClient.setQueryData(getGetMeQueryKey(), null);
      return null;
    }
    throw error;
  }
};
```

  login/register submit 전 기존 auth query를 cancel한다. 성공 응답의 User를 cache에 설정한 뒤
  refreshSession 결과가 User일 때만 `/dashboard` 또는 검증된 return path로 이동한다.
  `invalidateQueries()`와 `refetch()`를 동시에 호출하지 않는다. login mutation 성공 후 session 조회 실패는
  “계정 없음”이나 로그인 실패로 단정하지 않고 세션 재확인 버튼을 제공한다.
- [ ] **Step 4 — logout을 context로 옮긴다.** logout 요청 성공 또는 이미 anonymous인 401에서만
  `await queryClient.cancelQueries()` → auth 이외 query 제거 → auth cache=null → home 이동 순서.
  5xx/network 실패는 성공처럼 이동하지 않고 재시도를 보여준다. 성공 직후 기존 refetch()를 호출하지 않는다.
  session 전환 중 지연 query가 끝나도 이전 계정의 chat/profile cache가 다시 생기지 않는지 검사한다.
  custom chat/adapter fetch에도 AbortSignal을 전달하고 ChatPanel은 계정 id를 key로 사용해 계정 전환 시 unmount한다.
- [ ] **Step 5 — profile 편집을 Python 계약에 맞춘다.** `bio: form.bio || null`을 `bio: form.bio`로 바꾼다.
  Python은 null을 “변경 없음”으로 다루므로 삭제에는 빈 문자열이 필요하다.
  이름/과목/UTF-8 크기는 gateway와 동일한 한도로 안내하고 저장 성공 뒤 auth/profile 관련 query만 갱신한다.
  사용자가 편집 중인 form을 background auth refetch마다 덮어쓰지 않도록 초기화는 user.id 변경 또는 저장 성공에만 한다.
- [ ] **Step 6 — A→logout→B, logout failure, expired session, bio 지우기, double-submit을 검증한다.**
  `rg`로 hooks/use-auth.tsx 참조가 없을 때만 삭제한다. `fix: make session transitions deterministic`으로 commit한다.

### Task 22: 학습 미완성·실패·빈 결과를 구분하고 연결 오류를 보여준다

**Files:**
- Modify: `artifacts/peerbridge/src/lib/pythonApi.ts`, `src/lib/chat-api.ts`
- Modify: `src/components/ChatWidget.tsx`, `src/components/ConnectAction.tsx`, `src/components/SourceBadge.tsx`
- Modify: `src/pages/Recommendations.tsx`, `src/pages/PracticeLab.tsx`, `src/pages/Analytics.tsx`, `src/pages/Scheduling.tsx`, `src/pages/RequestDetail.tsx`
- Create: `artifacts/peerbridge/src/lib/api-error-message.ts`; Modify: `src/pages/Login.tsx`, `src/pages/Register.tsx`, `src/pages/Settings.tsx`, `index.html`
- Test: `e2e/learning-states.spec.ts`

**Interfaces:**
- `apiErrorMessage(error:unknown): string`는 ApiError.status와 bounded public error code만 소비한다.
- `getPythonApi<T>(path, init)`와 `chatFetch<T>(path, init)`는 기존 `customFetch`로 HTTP 처리를 통일한다.
- 기존 PyEnvelope / ScaffoldTodo / Python matching 상태는 서로 다른 계약으로 유지한다.

- [ ] **Step 1 — fixture를 실제 shape로 만든다.** 아래 4개 경우를 각 해당 화면에 주입한다.

```ts
const lessonTodo = {status:'todo', mission:7, message:'Complete Mission 7', guide:'DM messages'};
const studentFailure = {ok:false, success:false, source:'python', feature:'scheduling',
  student_module:{module:'scheduling', status:'runtime error', importable:true},
  error:'student_module_error', data:null};
const realEmpty = {ok:true, success:true, source:'python', feature:'analytics', data:[]};
const transportFailure = {error:'upstream_timeout'}; // HTTP 504, payload만으로 판정하지 않음
```

  todo는 “아직 구현할 미션”, failure는 실패+retry, realEmpty는 빈 결과,
  504는 연결 오류+retry로 보여야 한다. 메시지를 보냈는데 저장되지 않은 경우 성공 toast가 나오면 실패.
- [ ] **Step 2 — transport 중복을 제거한다.** getPythonApi/chatFetch 안의 raw fetch/error parsing을
  `customFetch<unknown>(path,{...init,responseType:'json',credentials:'include'})`로 바꾼다.
  schema가 맞지 않는 2xx null/HTML/임의 object를 성공 wrapper로 감싸지 않는다.
  matching/PracticeLab의 직접 fetch는 같은 transport를 사용하되 두 기존 payload 구조의 판별은 보존한다.
- [ ] **Step 3 — 오류 문구를 일관되게 매핑한다.** 401 sign in, 403 unavailable action, 404 not found,
  409 reload state, 422 check input, 429 retry later, 5xx/network connection problem.
  Retry-After가 있으면 초 단위 안내를 제공하고 mutation을 자동 재전송하지 않는다.
  raw error/detail/String(object)를 toast에 넣지 않는다. field error를 제공할 때도 입력값을 반사하지 않는다.
- [ ] **Step 4 — Connect/delete 실패를 보이게 한다.** 기존 ConnectAction은 onError가 없어 사용자에게
  실패가 보이지 않는다. mutation.isError와 공통 error message를 button 옆 role=alert로 렌더한다.
  실패한 match에서는 `justMatched`를 true로 바꾸지 않고 request state를 다시 조회한다.
  stale client state를 숨기기 위해 TS가 matchedUserId를 결정하거나 UPDATE하지 않는다.
- [ ] **Step 5 — chat polling은 기존 것을 유지한다.** 현재 5초 polling은 panel이 열려 있고 session이
  유효하며 real response일 때만 실행한다. ScaffoldTodo면 false, 429/network 실패는 backoff된 재시도 안내.
  DM todo에서 draft를 지우지 않고 sent처럼 렌더하지 않는다. 닫힌 panel/로그아웃에서 polling이 멈추는지 확인한다.
  session id를 chat query key에 포함하고 A/B cache가 섞이지 않게 한다.
- [ ] **Step 6 — 최소 접근성을 함께 수정한다.** 로그인/가입/설정 label에 htmlFor/id,
  autocomplete username/current-password/new-password, 오류 role=alert, pending aria-busy,
  index.html viewport의 maximum-scale=1 제거. 재설계나 전체 formatter 실행은 하지 않는다.
- [ ] **Step 7 — typecheck/build와 4상태 browser tests를 통과시키고 `fix: preserve learning states across API failures`로 commit한다.**

### Task 23: production bundle과 실제 Python 흐름을 각각 검증한다

**Files:**
- Reuse/extend: `e2e/auth.spec.ts`, `e2e/learning-states.spec.ts` — Task 21/22에서 작성한 tests
- Create: `e2e/classroom-flow.spec.ts`, `e2e/fixtures.ts`, `e2e/fixtures.mjs`, `scripts/smoke-classroom.mjs`
- Modify: `playwright.config.ts`, `package.json`
- Read only: 기존 Python runtime 전체

**Interfaces:**
- `pnpm e2e`: loopback fixture backend + 실제 built gateway + 실제 production bundle browser suite.
- `node scripts/smoke-classroom.mjs`: `CLASSROOM_ORIGIN`, `CLASSROOM_CREDENTIAL_FILE`, `SMOKE_ALLOWED_ORIGIN` 필요.
- smoke output: 각 check의 pass / learning-incomplete / transport-failure, requestId, elapsedMs; credential/body는 기록하지 않는다.

- [ ] **Step 1 — built artifact용 Playwright 설정을 작성한다.** fixture API는 child Node HTTP server로
  고정 loopback port 18181, gateway 18080, Vite preview 14200을 쓴다. 포트 충돌 시 기존 process에 붙지 않고 실패한다.

```ts
import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', retries:0, workers:1,
  use:{baseURL:'http://127.0.0.1:14200', trace:'retain-on-failure'},
  webServer:[
    {command:'node e2e/fixtures.mjs', port:18181, reuseExistingServer:false},
    {command:'node artifacts/api-gateway/dist/index.js', port:18080, reuseExistingServer:false,
      env:{PORT:'18080', GATEWAY_UPSTREAM_ORIGIN:'http://127.0.0.1:18181', GATEWAY_PUBLIC_ORIGIN:'http://127.0.0.1:14200', NODE_ENV:'test'}},
    {command:'pnpm --filter @workspace/peerbridge serve', port:14200, reuseExistingServer:false,
      env:{PORT:'14200', VITE_API_PROXY_TARGET:'http://127.0.0.1:18080'}},
  ],
});
```

  실제 파일명은 위 설정처럼 `e2e/fixtures.mjs`로 만들고 fixture data/type은 `e2e/fixtures.ts`에 둔다.
  서버 fixture는 session Cookie를 발급/확인하고 필요한 page 응답·의도한 오류 scenario만 가진다.
  이 fixture를 앱의 runtime fallback으로 import하지 않는다. Python 수정 없이 frontend/gateway만 검증하는 도구다.
- [ ] **Step 2 — 핵심 browser flow를 작성한다.**

```ts
test('all learning routes are reachable after login', async ({page}) => {
  await page.goto('/login');
  await page.getByLabel('School email').fill('mentor@classroom.example.edu');
  await page.getByLabel('Password', {exact:true}).fill('classroom-fixture-pass');
  await page.getByRole('button', {name:'Sign in', exact:true}).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  for (const route of ['/districts','/requests','/requests/new','/recommendations',
    '/practice-lab','/analytics','/scheduling','/admin/reports']) {
    await page.goto(route);
    await expect(page.getByText('This feature is unavailable', {exact:false})).toHaveCount(0);
    await expect(page.locator('main')).toBeVisible();
  }
});
```

  “차단 문구 없음”만 통과하지 않도록 각 route의 실제 heading·필수 API 요청을 추가 검증한다.
  로그인 race/오류·bio 지우기·A/B cache·mobile nav·request CRUD/Connect 오류·chat todo/실제 message
  시나리오는 Task 20–22의 명세대로 각각 test로 분리한다. API boundary integration tests를 browser에 중복 복제하지 않는다.
- [ ] **Step 3 — 실제 Python smoke는 별도 교실 target에서 수행한다.** origin은 HTTPS exact allowlist와
  같아야 하고 credential 파일은 mode 0600으로만 읽는다. smoke가 DB URL을 받거나 임의 DB에 seed하지 않는다.
  이미 Task 13에서 생성한 두 계정으로 로그인, own/other summary, self PATCH, districts/requests 조회,
  임시 request 생성·삭제, room message 전송·상대 조회, matching query, analytics/scheduling, reports 화면 API를 확인한다.
  작성한 fixture id만 cleanup하고 실패했다고 전체 table을 truncate하지 않는다.
- [ ] **Step 4 — WS도 실제 endpoint로 연결한다.** scripts/smoke-classroom.mjs는 Task 20에서 설치한
  `@playwright/test`의 chromium으로 두 browser context를 만들고 기존 Login 화면으로 로그인한다.
  로그인한 page 안의 **브라우저 native WebSocket**을 사용하면 Cookie/Origin이 실제 브라우저 규칙대로 전달된다.
  이 방식으로 별도 Node WS client나 frame encoder를 구현하지 않는다.

```js
const outcome = await page.evaluate(({roomId, message}) => new Promise(resolve => {
  const url = new URL(`/ws/chat/rooms/${roomId}`, location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url);
  const timer = setTimeout(() => {socket.close(); resolve('timeout');}, 5000);
  socket.onopen = () => socket.send(message); // 현재 Python은 raw text를 저장한다.
  socket.onmessage = () => {clearTimeout(timer); socket.close(); resolve('received');};
  socket.onerror = () => {clearTimeout(timer); socket.close(); resolve('error');};
}), {roomId: credentials.fixtures.globalRoomId, message: smokeMessage});
```

  page는 mentor context의 로그인된 page, credentials는 Task 13 JSON,
  smokeMessage는 `classroom-smoke-` + `crypto.randomUUID()`로 만든 비민감 canary다.
  다른 계정의 GET room messages에서도 동일 canary가 한 번만 보이는지 확인한다.
  Python의 DM WS는 학습 안내 후 close가 현재 기대값이다. 미완성 상태를 통과/실패와 별도 `learning-incomplete`로 기록한다.
  student failure도 개별 envelope와 task identifier를 기록하되 교실 앱 전체의 실패로 합산하지 않는다.
- [ ] **Step 5 — 상태를 숨기지 않고 결과를 보관한다.** fixture/browser 통과와 실제 Python smoke 결과를
  별도 record로 보관한다. Python에 필요한 psycopg 누락이면 Task 11 runtime 설치를 수정하고,
  student 함수 내부 오류이면 Python을 고치지 말고 학습 상태 목록을 갱신한다.
- [ ] **Step 6 — `test: cover classroom release flows`로 commit한다.** 실제 credential·cookie·browser storageState·trace의
  실사용 개인정보를 repository에 넣지 않는다. remote smoke에서는 trace를 끄고 synthetic local fixture에서만 trace를 보관한다.

### Task 24: CI와 Replit 전체 기능 배포를 연결한다

**Files:**
- Modify: `.github/workflows/release-surface.yml`, `.github/workflows/secret-scan.yml`, `package.json`, `.replit`
- Modify: `artifacts/api-gateway/.replit-artifact/artifact.toml`, `artifacts/api-server/.replit-artifact/artifact.toml`, `artifacts/peerbridge/.replit-artifact/artifact.toml`
- Modify: `scripts/verify-api-boundary.mjs`; Create: `docs/runbooks/classroom-release.md`
- Modify: `docs/release-surface.md`, `replit.md`

**Interfaces:**
- `pnpm verify:release`는 아래 검사들을 순서대로 실행하는 CI/local 공통 명령.
- release record: commit SHA, dist digest, runtime lock digest, gateway policy digest, schemaVersion, origin,
  backup reference, smoke summary, 이전 release reference.
- 운영 rollback은 기존 immutable artifact 또는 `GATEWAY_MAINTENANCE_MODE=true`; Python direct exposure는 금지.

- [ ] **Step 1 — CI의 정확한 기준을 바꾼다.** 기존 workflow name을 유지하면 branch protection 연결을
  불필요하게 바꾸지 않아도 된다. 내용은 reduced bundle 검사에서 전체 학습 검증으로 교체한다.
  checkout의 기존 SHA pin을 유지하고 새 setup actions는 검증한 commit SHA로 pin한다.
  Node는 Task 11의 `.node-version`, pnpm은 packageManager, PostgreSQL은 16.
  설치는 frozen lockfile; PR job에는 DB/SESSION_SECRET 등 실제 배포 secret을 전달하지 않는다.
- [ ] **Step 2 — 아래 실행 순서를 root script와 workflow에 연결한다.**

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build:release
pnpm test:gateway
pnpm test:migrations
pnpm --filter @workspace/db test
pnpm --filter @workspace/peerbridge test:unit
pnpm api:generate
git diff --exit-code -- lib/api-client-react/src/generated lib/api-zod/src/generated
pnpm api:contract-test
node scripts/verify-api-boundary.mjs
sh scripts/check-secrets.sh
pnpm test:secrets
pnpm exec playwright install --with-deps chromium
pnpm e2e
node scripts/check-python-unchanged.mjs "$PYTHON_FREEZE_BASE"
```

  db job에서 initdb/pg_ctl을 PATH에 제공하고 runner user로 disposable cluster를 실행한다.
  shared PostgreSQL service나 배포 DB에 테스트를 붙이지 않는다. Task 13/14 test scripts도 db test 명령에 포함한다.
  codegen 뒤 build/typecheck가 달라질 수 있으므로 drift가 발견되면 그 PR을 실패시키고 생성물을 정상 commit한 뒤 다시 전체 순서를 실행한다.
  Python freeze는 PR base SHA와 구현 시작 baseline을 구분한다: 이 non-Python 트랙 PR에서는 두 검사를 모두 수행한다.
  향후 학생 Python 과제 PR 전체를 영구 금지하는 저장소 정책으로 확대하지 않는다.
- [ ] **Step 3 — dependency gate를 올바른 범위로 둔다.** `pnpm audit --prod --audit-level high`와 전체
  audit report를 둘 다 보관한다. Orval/codegen과 Vite/build는 배포 산출물을 만드는 경로이므로 dev라는 이유로
  critical/high를 무시하지 않는다. 교실 release에서 사용하는 직접/전이 경로의 high/critical은 수정하고,
  사용하지 않는 mockup 전용 경로는 제외 근거와 version을 남긴다. unknown을 자동 exception으로 처리하지 않는다.
- [ ] **Step 4 — 정적/HTTP 보안 header를 실제 서빙 위치에 적용한다.** gateway는 이미 nosniff를 설정하므로
  그 기능을 중복 구현하지 않는다. 정적 HTML에는 provider가 지원하는 response header 설정을 우선 사용한다.
  시작 CSP는 `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
  referrer-policy=no-referrer, permissions-policy로 camera/microphone/geolocation 비활성, HTTPS HSTS를 설정한다.
  Replit artifact가 arbitrary header 설정을 제공하는지는 현재 미확인이다. 지원하지 않으면 HTML CSP meta로
  가능한 정책부터 적용하고 frame-ancestors/HSTS를 meta로 처리했다고 주장하지 않는다. 이 두 header는
  ingress 설정이 가능한 배포 옵션에서 적용한다. 이를 위해 새 백엔드나 CDN 서비스를 자동 구매하지 않는다.
  remote font를 없애는 선택을 하면 기존 CSS system font로 바꾸고 CSP의 Google origin도 제거한다.
- [ ] **Step 5 — 같은 배포 단위에 세 artifact를 맞춘다.** static frontend `/`, gateway `/api,/livez,/readyz,/ws`,
  private Python `paths=[]`와 loopback을 유지한다. 한 gateway/Python worker를 기본으로 배포하고
  Replit에서 실제 instance 수·WS routing 지원을 확인한다. 필요하면 지속 단일 인스턴스 deployment를 선택하되
  검증되지 않은 `.replit` enum 값을 추측해 작성하지 않는다.
  production frontend에서 VITE_FEATURE_* 값에 의존하지 않고 모든 page를 포함했는지 다시 확인한다.
- [ ] **Step 6 — 실제 외부 경계를 확인한다.** 배포 origin에서 모든 메뉴, API, 두 WS handshake,
  HTTPS secure session cookie, `/readyz`, asset 404/SPA deep link를 검사한다.
  현재 runbook의 잘못된 `:8081` 한 개 검사로 끝내지 않고 **private backend 8181**, 이전 backend 8000,
  개발 preview 8081/21288, 플랫폼 alternate host/port mapping을 읽기 전용으로 점검한다.
  추가 승인되지 않은 API가 Python에 직접 닿지 않는지 확인한다. unknown API가 SPA HTML 200으로 바뀌면 실패다.
- [ ] **Step 7 — 학습용 출시 결과를 기록한다.** 필수 연결이 동작하고 전체 메뉴/API가 공개되면 classroom release로 기록한다.
  DM 미완성·matching/analytics/scheduling 학생 오류는 노출된 과제 상태 목록에 남기며 기능을 다시 잠그지 않는다.
  startup/DB failure, secret 유출, gateway bypass는 운영 rollback 사유다. 수업 중 문제 시 이전 artifact로 되돌리고
  스키마를 자동 다운그레이드하지 않는다. 필요할 때 Task 14의 별도 DB restore 절차를 사용한다.
- [ ] **Step 8 — release 문서와 설정을 `ci: verify full classroom deployment`로 commit한다.**
  최종 diff와 Python hash 검사를 확인하고 실제 배포는 사용자가 요청한 실행 단계에서 수행한다.

## 최종 수용 시나리오

| 사용자가 하는 일 | 기대 결과 |
| --- | --- |
| 새 계정 가입 후 Dashboard 이동 | 세션 확인 완료 후 정상 이동, 로그인 화면으로 튕기지 않음 |
| Requests의 filter 변경 | gateway가 검증한 query를 Python에 전달 |
| 다른 사용자의 profile 조회/수정 시도 | 최소 profile 조회 가능, 타인 수정은 거부 |
| Connect 호출 | Python의 실제 결과 또는 이해 가능한 실패 표시 |
| 두 계정으로 room chat | 기존 Python REST 저장·조회가 동작, panel 닫으면 polling 중단 |
| DM 미완성 미션 실행 | 기능은 접근 가능하고 미완성 상태가 보임; 거짓 성공 없음 |
| matching/scheduling student 오류 | 해당 module/status와 retry 표시, 다른 화면 사용 가능 |
| 학생이 Python 과제를 다음에 완성 | 이번 TS 대체 구현 없이 기존 endpoint의 실제 결과가 화면에 반영 |
| 전체 코드 diff 확인 | 이번 구현에서 동결된 Python 파일 변경 0 |

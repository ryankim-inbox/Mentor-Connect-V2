# Learning API and Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 현재 Python의 REST 48 operations와 WS 2 endpoints를 학습 배포에서 사용할 수 있게 한다.

**Architecture:** 기존 gateway의 default-deny 경계를 유지하면서 blanket quarantine을 명시적인 method/path/query 정책으로 교체한다. Python에 세션·업무 처리를 위임하고 gateway에는 전송 검증, 응답 projection, 운영 health만 둔다.

**Tech Stack:** Node 24 native HTTP/streams/crypto, TypeScript, 기존 Zod, node:test, 기존 Orval, PostgreSQL read-only probe.

**Spec:** [전체 설계](../specs/2026-09-09-full-learning-deployment-design.md) 5절이 endpoint별 정확한 계약이다. [마스터](2026-09-09-full-learning-production.md)의 Global Constraints 전체를 상속한다.

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
| api-gateway/src/route-policy.ts | 전체 endpoint의 method/path/query 선언과 canonical match |
| api-gateway/src/gateway.ts | 기존 HTTP lifecycle, Python 호출, session 확인, 응답 전송 |
| api-gateway/src/public-contract.ts | HTTP boundary schema, error mapping, PII projection |
| api-gateway/src/request-controls.ts | Origin·bounded rate counter |
| api-gateway/src/websocket.ts | native HTTP upgrade tunnel; frame 해석 없음 |
| api-gateway/src/readiness.ts | 제한 시간 내 Python health·read-only DB probe |
| lib/api-spec/openapi.yaml | 48 REST operations의 공개 문서/생성 입력 |

### Task 15: 전체 REST policy와 query 전달을 구현한다

**Files:**
- Modify: `artifacts/api-gateway/src/route-policy.ts`, `src/gateway.ts`
- Modify: `artifacts/api-gateway/test/route-policy.test.ts`, `test/server.test.ts`, `test/self-only.test.ts`, `src/gateway.test.ts`
- Modify: `docs/runbooks/api-gateway.md`, `docs/release-surface.md`

**Interfaces:**

```ts
export type PublicRoute = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  template: string;
  family: string;
  authentication: 'none' | 'cookie' | 'session';
  allowsBody: boolean;
  requiresJson: boolean;
  queryKeys: readonly string[];
};
export type PublicRouteMatch = PublicRoute & {
  upstreamPath: string; // canonical pathname + 검증하고 재직렬화한 query
  resourceId?: number;
};
export declare const publicRoutes: readonly PublicRoute[];
export declare function resolvePublicRoute(method: string, target: string): PublicRouteMatch | undefined;
```

  위 코드는 소비자가 보는 타입 계약이다. 실제 배열/함수 구현은 route-policy.ts 한 곳에 둔다.
  기존 gatewayAllowlist의 test import도 이 배열로 바꾼다.
  `/api/auth/me`만 `authentication:'cookie'`: upstream 응답을 세션 검증 결과로 사용하므로 자신을 다시 호출하지 않는다.
  다른 session 경로는 기존 verifySession을 재사용한다.

- [ ] **Step 1 — 성공해야 할 요청이 현재 거부되는 테스트를 추가한다.** 기존 테스트의 server 시작/종료 helper를 재사용한다.

```ts
assert.equal(resolvePublicRoute('GET', '/api/requests?status=open&districtId=2')?.upstreamPath,
  '/api/requests?status=open&districtId=2');
assert.equal(resolvePublicRoute('DELETE', '/api/requests/2')?.family, 'requests');
assert.equal(resolvePublicRoute('GET', '/api/practice/matching/1?limit=5')?.family, 'practice');
assert.equal(resolvePublicRoute('GET', '/api/scheduling/suggest?user_a=1&user_b=2')?.family, 'scheduling');
assert.equal(resolvePublicRoute('GET', '/api/not-a-route'), undefined);
assert.throws(() => resolvePublicRoute('GET', '/api/requests?status=open&status=closed'));
```

  명령: `pnpm --filter @workspace/api-gateway test`. 기존에는 route 함수가 없거나 quarantine으로 실패해야 한다.
- [ ] **Step 2 — spec 5절의 48개 REST operation을 literal 배열로 등록한다.** method별 row를 만들고
  `/{id}`류는 `([1-9][0-9]*)` 및 Number.isSafeInteger로 검사한다. moduleName만 세 문자열 enum.
  기존 parseRequestTarget의 path percent/dot/backslash/repeated-slash 거부는 유지한다.
  encoded **query 값**은 URLSearchParams로 읽되 malformed encoding을 먼저 거부한다.

```ts
const keys = [...searchParams.keys()];
if (new Set(keys).size !== keys.length || keys.some(key => !route.queryKeys.includes(key))) {
  throw new TypeError('invalid_query');
}
const upstreamPath = pathname + (searchParams.size ? `?${searchParams.toString()}` : '');
```

  query 규칙: districtId/tagId/user_a/user_b는 양의 safe integer, limit 1–20;
  role=mentor|mentee, status=open|matched|closed; search는 UTF-8 200 bytes 이하;
  type=high_school|unified. `scheduling/suggest`에는 user_a와 user_b 둘 다 필수.
  없는 선택 query는 추가하지 않고 Python 기본값을 사용한다. 빈 숫자·중복·unknown은 400, unknown route는 404.
- [ ] **Step 3 — gateway의 early quarantine branch를 route lookup으로 교체한다.** normalize/classify 함수가
  실제로 더 이상 쓰이지 않으면 tests와 함께 제거한다. 모든 `/api/*`를 forwarding하는 fallback은 만들지 않는다.
  `fetchUpstream()`에는 pathname만 주던 부분 대신 검증한 `upstreamPath`를 넘긴다.
  본문 없는 POST logout/Connect와 DELETE는 body 없이 전달하고 upstream 204도 body 없이 반환한다.
- [ ] **Step 4 — profile READ와 WRITE 정책을 분리한다.** GET은 로그인한 다른 사용자도 기존
  `sanitizeSelfProfile(body, requestedId)`와 동일한 네 필드 projection을 사용한다.
  PATCH는 현재 verifySession.userId === requestedId와 forbidden key 검사를 그대로 유지한다.
  사용자 간 READ test는 최소 응답 200, 타인 PATCH는 404/upstream profile write 0으로 바꾼다.
  auth/me는 본인 account 정보만 반환하며 email이 auth/me에서 보이는 것을 타인 profile 노출로 혼동하지 않는다.
- [ ] **Step 5 — HTTP integration test를 실행한다.** 각 route family마다 유효 요청이 fixture upstream까지
  정확한 method/path/query/body/Cookie로 한 번 전달되는지 확인한다. session 검증용 auth/me 호출은 별도 계수한다.
  duplicate header, invalid path, unexpected method, body limit, maintenance, 타인 PATCH 부정 검사는 유지한다.
- [ ] **Step 6 — docs의 allowlist와 quarantine 설명을 전체 학습 계약으로 갱신하고 `feat: expose learning REST routes through gateway`로 commit한다.**

### Task 16: 계약·생성물·error/response projection을 맞춘다

**Files:**
- Modify: `lib/api-spec/openapi.yaml`, `lib/api-spec/orval.config.ts`, `lib/api-spec/package.json`
- Generate: `lib/api-client-react/src/generated/**`, `lib/api-zod/src/generated/**`
- Create: `artifacts/api-gateway/src/public-contract.ts`, `artifacts/api-gateway/test/public-contract.test.ts`, `scripts/test-api-contract.mjs`
- Create: `lib/api-spec/test/api-contract.mjs`
- Modify: `artifacts/api-gateway/src/gateway.ts`, `artifacts/api-gateway/package.json`, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`

**Interfaces:**
- `publicError(status:number): {error:string}`: HTTP 오류에만 적용.
- `projectStudentPayload(payload:unknown): unknown`: 학습 envelope 상태·data·source 보존, 민감한 진단 문자열만 제한.
- `projectProfile(payload:unknown, expectedId:number): ProfileSummary`: `{id,name,subjects,createdAt}`.
- `pnpm api:generate` = `pnpm --filter @workspace/api-spec codegen`.
- `pnpm api:contract-test` = `node scripts/test-api-contract.mjs`.

- [ ] **Step 1 — canary projection 테스트를 작성한다.** 422 detail/input, 500 SQL/DSN, debug header,
  타인 profile email이 남으면 실패. `status:'todo'`와 `success:false,data:null`는 HTTP 성공 payload의
  서로 다른 학습 상태로 보존되어야 한다.

```ts
assert.deepEqual(publicError(422), {error: 'invalid_input'});
assert.deepEqual(publicError(500), {error: 'backend_error'});
const todo = {status: 'todo', mission: 7, message: 'Complete Mission 7'};
assert.deepEqual(projectStudentPayload(todo), todo);
const failed = projectStudentPayload({success: false, source: 'python', data: null,
  error: 'postgresql connection failed with audit-canary'}) as Record<string, unknown>;
assert.equal(failed.success, false);
assert.equal(failed.data, null);
assert.ok(!JSON.stringify(failed).includes('audit-canary'));
```

- [ ] **Step 2 — codegen/db dependencies를 먼저 업데이트한다.** 감사 기준 Orval `>=8.22.0`,
  drizzle-orm `>=0.45.2`가 최소 후보다. `pnpm view orval version`, audit의 patched ranges와 release notes를
  확인하고 해당 major 내 수정 버전을 **exact** pin한다. Vite·lodash·postcss·js-yaml 등 transitive도 현재
  audit 경로별로 업데이트하고 전체 report를 보관한다. 무관한 major migration이나 ignore는 추가하지 않는다.
  gateway는 새 라이브러리 대신 이미 workspace에 있는 `zod`를 direct dependency로 선언해 boundary에 사용한다.
  Node dist가 실행 시 source TS package export를 직접 import하지 않도록 gateway-local public-contract.ts를 사용한다.
- [ ] **Step 3 — OpenAPI를 전체 계약에 맞춘다.** 기존 28 operation을 삭제하지 않고 부족한 20 operation을
  spec 5절 및 read-only Python body model에서 추가한다. WS 2개는 `docs/runbooks/api-gateway.md`에 별도 기술한다.

```yaml
components:
  securitySchemes:
    cookieAuth:
      type: apiKey
      in: cookie
      name: peerbridge_session
  schemas:
    ScaffoldTodo:
      type: object
      required: [status, message]
      properties:
        status: {type: string, enum: [todo]}
        mission: {type: integer}
        message: {type: string}
        guide: {type: string}
    ErrorResponse:
      type: object
      required: [error]
      additionalProperties: false
      properties:
        error: {type: string}
```

  session route마다 `security: [{cookieAuth: []}]`, public route에는 `security: []`.
  ProfileSummary는 id/name/subjects/createdAt 네 필드. self PATCH 응답도 같은 summary.
  learning responses는 기존 ChatRoom/Message/Dm 모델과 ScaffoldTodo의 oneOf;
  adapter는 `ok`, `success`, `source`, `student_module`, `data`를 가진 PyEnvelope와 matching의 별도 shape를 보존한다.
  401/403/404/409/422/429/502/503/504 응답 및 Retry-After/X-Request-Id 헤더를 명시한다.
  모든 operation에 적용되는 것은 references로 재사용하고 실제 안 쓰는 status까지 endpoint마다 복제하지 않는다.
- [ ] **Step 4 — 오류 응답을 허용 값으로 매핑한다.** 400/422→invalid_input, 401→unauthorized,
  403→forbidden, 404→not_found, 409→conflict, 429→rate_limited, 5xx→backend_error.
  gateway 자체 maintenance/upstream_timeout 등 기존 고정 error code는 보존한다.
  `detail[].input`, raw string, upstream stack은 외부에 전달하지 않는다. 모든 API 응답에 no-store를 적용한다.
  Set-Cookie는 기존 별도 처리로 전달하고 validation에 실패한 성공 payload는 502로 바꾼다.
- [ ] **Step 5 — 학습 payload는 상태를 보존한 projection을 한다.** module/attempted_function/status/available_functions,
  mission/guide와 성공 data는 계약대로 보존한다. 오류일 때 자유 텍스트 error는 `student_module_error`로,
  실패 message는 `Student module returned an error. Check the named function.`로 고정한다.
  실제 코드가 주는 미완성 mission message는 bounded string으로 표시한다. 관리자 rows는
  userId/name/reportCount/blockCount/status/lastReportedAt/topReasons만 추출한다. email/district/raw result를 덧붙이지 않는다.
  기존 `source:'adapter-fallback'`은 숨기지 않는다. **TS fallback data를 생성하지 않는다.**
- [ ] **Step 6 — HTTP JSON timestamp는 string으로 통일한다.** Orval Zod 설정의 response date coercion을 제거하고
  `useDates:false`로 생성한다. gateway의 간단한 boundary validator와 생성 schema를 같은 fixture로 검사한다.
  generated React hook 이름/parameter 변동이 있으면 모든 caller를 `rg`로 확인해 typecheck를 통과시킨다.
- [ ] **Step 7 — route inventory와 재생성 diff를 검증한다.** `test-api-contract.mjs`는 publicRoutes를 compiled JS에서
  읽고 OpenAPI YAML parser는 이미 workspace tree에 있는 `yaml`을 `api-spec` direct devDependency로 선언해 사용한다.
  감사에서 수정 범위로 확인된 2.8.3 이상을 exact pin하고 parser를 직접 import하는 inventory script는
  `lib/api-spec/test/api-contract.mjs`에 둔다. root `scripts/test-api-contract.mjs`는 그 파일을 import하는 한 줄 entry다.
  Python route는 실행하지 않고 include-router 파일의 decorator literal만 읽는다. 복잡한 dynamic route를 발견하면
  정적 검사가 성공했다고 하지 말고 inventory를 명시적으로 갱신한다.
  `{user_id}`와 `{id}`처럼 parameter 이름만 다른 경로는 `{param}`으로 정규화해 method+path Set를 비교한다.
  기대값은 Python REST 48 = public OpenAPI 48 = gateway REST 48; gateway `/livez`,`/readyz`는 별도 목록이다.
  `pnpm api:generate` 두 번 후 diff 0, `pnpm api:contract-test`, `pnpm typecheck`, gateway/DB tests 실행.
- [ ] **Step 8 — `feat: align learning API contracts and safe errors`로 commit한다.** codegen update와 dependency 변화가
  너무 큰 경우 dependency + regenerated files를 먼저 독립 commit하되 최종 계약 검증까지 같은 task에서 완료한다.

### Task 17: Origin·입력·작은 rate limit을 추가한다

**Files:**
- Create: `artifacts/api-gateway/src/request-controls.ts`, `test/request-controls.test.ts`
- Modify: `artifacts/api-gateway/src/gateway.ts`, `src/public-contract.ts`, `src/index.ts`, gateway artifact env 설정

**Interfaces:**
- `assertAllowedOrigin(origin:string|undefined, publicOrigin:string): void`
- `createLimiter(now:()=>number): {take(key:string,limit:number): {allowed:boolean,retryAfter:number}}`
- `GATEWAY_PUBLIC_ORIGIN`은 exact HTTPS origin, 개발 환경만 loopback HTTP를 허용한다.

- [ ] **Step 1 — 출처 검증과 시간 고정 limiter test를 작성한다.** hostile/missing/null origin mutation은 upstream 0.
  일반 GET에는 Origin을 강요하지 않는다. 허용 origin의 body 없는 logout/Connect도 성공해야 한다.

```ts
assert.throws(() => assertAllowedOrigin('https://evil.invalid', 'https://classroom.example'));
assert.doesNotThrow(() => assertAllowedOrigin('https://classroom.example', 'https://classroom.example'));
let now = 0;
const limiter = createLimiter(() => now);
for (let i = 0; i < 10; i++) assert.equal(limiter.take('login:fixture', 10).allowed, true);
assert.equal(limiter.take('login:fixture', 10).allowed, false);
now = 60_000;
assert.equal(limiter.take('login:fixture', 10).allowed, true);
```

- [ ] **Step 2 — Origin은 문자열 exact equality로 configured origin과 비교한다.** Host/X-Forwarded-Host를
  target origin으로 신뢰하지 않는다. mutation와 WS는 Origin 필수; curl/test에도 명시한다.
  JSON body가 있는 요청에만 JSON Content-Type을 요구한다. 로그인·가입은 object와 allowed keys를 검증한다.
  password는 빈 값/72 UTF-8 bytes 초과를 reject하고 절대로 잘라서 Python에 보내지 않는다.
  self PATCH의 기존 바이트 제한과 subjects/name validation을 재사용한다.
- [ ] **Step 3 — 단일 프로세스 fixed-window limiter를 구현한다.** window 60초, Map 최대 10,000 entries,
  만료 entry 정리, 저장 한도 초과는 신규 key 429. per-account login 10/min + login global 120/min,
  register global 30/min, session mutation 60/min, expensive practice call 12/min을 초기값으로 둔다.
  account key는 정규화 email의 SHA-256, session key는 verifySession.userId. raw cookie/email은 저장·로그하지 않는다.
  429에는 정수 Retry-After를 넣는다. X-Forwarded-For는 이 단계에서 사용하지 않아 spoofing과 교실 NAT 오판을 피한다.
  `ponytail: per-process counters; use a shared limiter only if deployment gains multiple gateway instances` 주석을 남긴다.
- [ ] **Step 4 — 정상 교실 부하도 검증한다.** 20개 서로 다른 session이 room polling을 해도 GET을 mutation
  limiter로 제한하지 않아야 한다. 매칭 버튼 반복은 제한하고 Retry-After UI는 Task 22로 연결한다.
  server.headersTimeout=10_000, requestTimeout=15_000, keepAliveTimeout=5_000, maxHeadersCount=64를
  createGatewayServer에 명시한다. 현재 request/response byte limit과 upstream timeout을 유지한다.
- [ ] **Step 5 — gateway 전체 tests를 실행하고 `feat: bound classroom gateway requests`로 commit한다.**

### Task 18: 두 Python WebSocket endpoint를 tunnel로 연결한다

**Files:**
- Create: `artifacts/api-gateway/src/websocket.ts`, `test/websocket.test.ts`
- Modify: `artifacts/api-gateway/src/gateway.ts`, `src/index.ts`, gateway `package.json`
- Modify: `artifacts/peerbridge/vite.config.ts`, `scripts/verify-api-boundary.mjs`, gateway artifact 설정

**Interfaces:**
- `createWebSocketUpgradeHandler({upstreamOrigin,verifySession,assertOrigin,logger}): (request:IncomingMessage,socket:Duplex,head:Buffer)=>void`
- `verifySession(request,signal,requestId): Promise<{userId:number,setCookies:readonly string[]}>`은 gateway의 기존 함수에 config를 bind한 callback.
- `closeWebSockets(): void`는 gateway shutdown에서 모든 등록 client/upstream socket을 닫는다.

- [ ] **Step 1 — synthetic native HTTP upgrade upstream으로 red test를 만든다.** 인증된 두 정확한 path는 101,
  anonymous/hostile origin/unknown path는 handshake 전 거부. 기존 policy는 모두 403이라 양성 테스트가 실패한다.
- [ ] **Step 2 — frame을 해석하지 않는 native tunnel을 구현한다.** exact path의 positive id만 허용하고
  query는 거부한다. `http.request(new URL(request.url, upstreamOrigin), {headers})`를 사용한다.
  forward header는 Cookie와 WS handshake 필드 및 generated X-Request-Id만 포함한다.
  handshake `head` buffer가 있으면 올바른 상대 socket에 한 번만 전달한다.

```ts
upstreamRequest.on('upgrade', (upstreamResponse, upstreamSocket, upstreamHead) => {
  // 검증된 101 status와 allowlisted WS/Set-Cookie headers를 client socket에 먼저 쓴다.
  if (head.length) upstreamSocket.write(head);
  if (upstreamHead.length) socket.write(upstreamHead);
  socket.pipe(upstreamSocket);
  upstreamSocket.pipe(socket);
});
```

  101 응답은 status line, Upgrade, Connection, Sec-WebSocket-Accept 및 선택된 protocol/extensions,
  별도로 보존한 Set-Cookie, X-Request-Id로 직렬화한다. header 값에 CR/LF가 있으면 reject.
  accept 키는 원 request key + RFC GUID의 SHA-1/base64와 일치해야 한다. 미요청 subprotocol/extension은 허용하지 않는다.
  비-101 upstream 응답은 bounded body/status로 종료하고 upgrade 성공으로 표시하지 않는다.
  5초 handshake timeout, disconnect 양방향 cleanup, upstream error handler, maintenance 거부를 구현한다.
- [ ] **Step 3 — close/backpressure와 resource cap을 검증한다.** pipe의 backpressure를 재사용한다.
  user당 2개·전체 40개 concurrent tunnel cap, 종료 시 count 해제, idle timeout 120초로 시작한다.
  per-frame size/rate moderation은 Python WS 구현 영역이므로 TS frame parser를 만들지 않고 한계에 기록한다.
  app shutdown에서 upgrade socket도 닫아 `server.close()`만 기다리는 누수를 방지한다.
- [ ] **Step 4 — Vite dev/preview에도 WS proxy를 추가한다.** 기존 `/api`와 같은 gateway target을 쓴다.

```ts
'/ws': {
  target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
  changeOrigin: true,
  ws: true,
}
```

  실제 배포의 `/ws`는 이미 gateway artifact 소유다. Python port를 새로 공개하지 않는다.
  브라우저 ChatWidget는 현재 REST polling을 유지한다. 학생 WS 실습을 위해 endpoint만 연결한다.
- [ ] **Step 5 — 101/403/non-101/timeout/disconnect/head-buffer tests와 전체 gateway suite를 통과시킨다.**
  Task 23에서 실제 Python room WS를 확인하고 DM WS의 학습 메시지 후 close도 기록한다.
  `feat: tunnel classroom WebSockets to Python`으로 commit한다.

### Task 19: readiness와 진단 가능한 최소 운영 로그를 추가한다

**Files:**
- Create: `artifacts/api-gateway/src/readiness.ts`, `test/readiness.test.ts`
- Create: `scripts/write-release-metadata.mjs`
- Modify: `artifacts/api-gateway/src/gateway.ts`, `src/index.ts`, gateway `package.json`, `pnpm-lock.yaml`
- Modify: `artifacts/api-gateway/.replit-artifact/artifact.toml`, `scripts/verify-api-boundary.mjs`, `docs/runbooks/api-gateway.md`

**Interfaces:**
- `checkReadiness(): Promise<boolean>`: Python `/api/healthz` + read-only DB SELECT 1·ledger tail 검사.
- `READINESS_DATABASE_URL`: read-only DB credential. `RELEASE_SHA`: 배포한 commit SHA.
- `/readyz`: `{status:'ready'|'not_ready'}`만 반환; 200 또는 503. `/livez`는 기존 200 유지.

- [ ] **Step 1 — DB failure 또는 upstream failure에서 livez 200/readyz 503 test를 만든다.**
  학생 matching/scheduling 오류 envelope는 health probe 대상이 아니므로 readiness에 영향을 주지 않는다.
- [ ] **Step 2 — 기존 workspace의 pg를 gateway direct dependency로 사용한다.** Pool max=1,
  connectionTimeoutMillis=1_000, statement_timeout=1_000; SQL은 BEGIN READ ONLY, SELECT 1,
  operational ledger의 마지막 migration ID, ROLLBACK만 허용한다. expected tail은 schema version asset에서
  build 시 읽어 dist metadata에 넣는다. `scripts/write-release-metadata.mjs`가
  `database/schema/version.json`의 currentMigrationId와 RELEASE_SHA 또는 `git rev-parse HEAD`를 읽어
  `artifacts/api-gateway/dist/release.json`을 쓰게 한다. gateway build script는
  `tsc -p tsconfig.json && node ../../scripts/write-release-metadata.mjs`로 갱신한다.
  DB error detail은 외부에 전달하지 않는다. READINESS_DATABASE_URL이 없으면 startup 자체를 throw하지 않고
  readyz를 503으로 유지하므로 DB 없는 local fixture도 gateway 동작 검사를 할 수 있다.
  probe는 전체 2초 deadline, 2초 cached result, 동시 요청은 같은 in-flight promise를 공유한다.
- [ ] **Step 3 — gateway가 `/readyz`를 직접 처리하고 artifact paths/startup probe를 갱신한다.**
  paths는 `/api`, `/livez`, `/readyz`, `/ws`; boundary verifier의 정확한 path 기대값도 같이 수정한다.
  startup에서 readyz를 쓸 때 Python보다 먼저 떠도 정상적으로 재시도되는 hosting 동작을 staging에서 확인한다.
- [ ] **Step 4 — 현재 로그에 duration과 family를 추가하고 raw path를 제거한다.** unknown은 family=unknown;
  outcome/status/requestId/durationMs/upstreamDurationMs만 기록한다. userId/email/query/raw path/body는 기록하지 않는다.
  RELEASE_SHA는 startup event 한 번만 기록한다. incoming X-Request-Id는 계속 교체한다.
- [ ] **Step 5 — SIGTERM에서 HTTP drain·WS close·pg Pool.end를 10초 안에 수행한다.** readyz는 draining 동안 503.
  SQL/cookie/email canary가 로그에 없는지, missing credential/DB failure가 무한 대기가 아닌지 검사한다.
  실제 Python access log와 gateway id를 연결하는 코드는 새로 Python에 넣지 않는다.
- [ ] **Step 6 — tests와 static boundary 검증 후 `ops: add bounded classroom readiness`로 commit한다.**
  새 test 파일들이 실제 실행되도록 gateway `test` script의 명시 목록에도 public-contract,
  request-controls, websocket, readiness test를 추가한다. 파일 생성만 하고 CI에서 실행하지 않는 상태로 끝내지 않는다.

## 이 계획의 검증 마감

- [ ] 48 REST + 2 WS 목록을 빠짐없이 연결했다.
- [ ] query/method/body 없는 POST/204/Set-Cookie 계약을 보존했다.
- [ ] 학생 실패를 200 성공 데이터로 변환하지 않고 교육 상태로 표현한다.
- [ ] 실제 backend 알고리즘이나 세션 서명 구현을 TS에 추가하지 않았다.

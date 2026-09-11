# API gateway 운영 절차

상태: 전체 학습 REST 계약과 두 WebSocket tunnel이 구현되었고 production UI가 공개되어 있다. 실제 Python WebSocket과 provider ingress 검증은 Task 23에서 수행한다.
소유자: Release manager(배포 승인과 증빙), Platform owner(네트워크 경계)

## 공개 경계

브라우저의 외부 API 진입점은 `artifacts/api-gateway` 하나다. Python backend는
`127.0.0.1:8181`에서 기존 업무 로직과 데이터 접근을 담당하며 직접 공개하지 않는다.
Gateway의 `GET /livez`는 upstream을 호출하지 않는 process liveness endpoint다.

REST 경로는 `src/route-policy.ts`의 48개 literal operation만 허용한다. 등록되지 않은
경로와 method는 404, malformed canonical path와 잘못된 query는 400으로 거부한다.
무제한 `/api/*` fallback은 없다. WebSocket은 아래 두 exact path만 session/Origin 검증 후 private Python으로 연결한다.

## REST allowlist

`public`은 세션이 필요 없고 `session`은 요청 Cookie를 그대로 사용해 private
`GET /api/auth/me`에서 양의 정수 사용자 id를 확인한다. `cookie`인
`GET /api/auth/me`는 그 응답 자체가 검증 결과이므로 재귀 검증하지 않는다.

| 정책    | Operations                                                                                                                                                                                                                |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| public  | `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/districts`, `GET /api/stats/overview`, `GET /api/healthz`                                                                                                    |
| cookie  | `GET /api/auth/me`                                                                                                                                                                                                        |
| session | `POST /api/auth/logout`, `GET/PATCH /api/users/{id}`, `GET /api/districts/{id}`, `GET /api/tags`                                                                                                                          |
| session | `GET/POST /api/requests`, `GET/PATCH/DELETE /api/requests/{id}`, `POST /api/requests/{id}/match`, `POST /api/reports`                                                                                                     |
| session | `GET/POST /api/blocks`, `DELETE /api/blocks/{id}`, `GET /api/stats/district/{id}`                                                                                                                                         |
| session | `GET /api/matches/{questionId}`, `POST /api/matches`                                                                                                                                                                      |
| session | `GET /api/chat/rooms`, `GET/POST /api/chat/rooms/{id}/messages`, `GET /api/dms`, `POST /api/dms/start`, `GET/POST /api/dms/{id}/messages`                                                                                 |
| session | `GET /api/practice/status`, `GET /api/practice/matching/{questionId}`, `GET /api/practice/locations/status`, `POST /api/practice/locations/test`, `GET /api/practice/blocks/status`, `GET /api/practice/raw/{moduleName}` |
| session | `GET /api/analysis/status`, four `GET /api/analytics/*` operations, `GET /api/python-reports/status`, `GET /api/python-reports/summary`                                                                                   |
| session | `GET /api/scheduling/status`, `GET /api/scheduling/overview`, `GET /api/scheduling/suggest`, `GET /api/admin/flagged-users`                                                                                               |

Canonical ids match `[1-9][0-9]*` and must be JavaScript safe integers. Practice raw modules
are limited to `find_matches`, `locations`, and `get_blocks`.

## Query와 body 정책

Gateway parses allowed query values with `URLSearchParams`, rejects malformed percent encoding,
duplicate keys, unknown keys, and invalid values, then forwards the validated serialized query.
It never inserts an omitted optional value, so Python defaults remain authoritative.

| Route                                                                         | Allowed query                                                                                                      |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `GET /api/districts`                                                          | `type` is `high_school` or `unified`; `search` is at most 200 UTF-8 bytes                                          |
| `GET /api/requests`                                                           | positive safe `districtId` and `tagId`; `role` is `mentor` or `mentee`; `status` is `open`, `matched`, or `closed` |
| `GET /api/matches/{questionId}` and `GET /api/practice/matching/{questionId}` | `limit` from 1 through 20                                                                                          |
| `GET /api/scheduling/suggest`                                                 | positive safe `user_a` and `user_b`; both required                                                                 |

Every POST/PATCH/DELETE request must carry an `Origin` exactly equal to the configured public
origin. Requests that actually carry a JSON body require `application/json`. `POST /api/auth/logout`,
`POST /api/requests/{id}/match`, and every DELETE are bodyless. The default request limit is
1 MiB and the practice location test is capped at 16 KiB. Upstream response bodies default to
2 MiB. Request-body and upstream-response timeouts default to 10 and 5 seconds.

Login accepts only `email` and `password`; registration accepts only `email`, `name`, `password`,
`role`, and `districtId`. Passwords must be 1 through 72 UTF-8 bytes and are never truncated.
Accepted auth JSON bytes are forwarded unchanged. Only SHA-256 of the trimmed, lowercased email is
kept as the per-account limiter identity.

Profile GET is available to a signed-in user for another canonical user id, but gateway output is
always projected to `id`, `name`, `subjects`, and `createdAt`. PATCH remains self-only and accepts
only `name`, `bio`, and `subjects`; an id mismatch returns 404 without a profile write upstream.
The account email returned by `/api/auth/me` belongs to the authenticated user and does not change
the public profile projection.

## 보안 동작

- Cookie and Authorization reach only an allowlisted upstream request.
- Authentication-dependent GET responses are forced to `Cache-Control: no-store` with a
  de-duplicated `Vary: Cookie`.
- Duplicate headers, Transfer-Encoding, Expect, absolute targets, backslashes, percent-encoded
  paths, dot segments, repeated slashes, uppercase route variants, and trailing slashes are rejected.
- Mutation and WebSocket Origin checks compare with the configured origin as an exact string.
  `Host`, `X-Forwarded-Host`, and `X-Forwarded-For` do not select or bypass an origin or rate bucket.
- Hop-by-hop, Server, Location, CORS, compression, and upstream content-length headers are stripped.
- Logs receive fixed event names, canonical paths, method, status, and correlation id, never Cookie,
  Authorization, request bodies, or upstream error details.

`GATEWAY_PUBLIC_ORIGIN` is required at startup. Production accepts only one canonical exact HTTPS
origin such as `https://classroom.example.com`; replace the example in the gateway artifact settings
with the deployment's real external origin before release. It must not contain credentials, a path,
query, fragment, trailing slash, or normalized spelling difference. Development/test may explicitly
use `http://localhost:<port>`, `http://127.0.0.1:<port>`, or `http://[::1]:<port>` with
`NODE_ENV=development|test`. The gateway never derives this value from request headers.

`GATEWAY_UPSTREAM_ORIGIN` must be a credential-free loopback HTTP origin. Limits can be reduced with
`GATEWAY_MAX_BODY_BYTES`, `GATEWAY_MAX_RESPONSE_BYTES`, `GATEWAY_BODY_TIMEOUT_MS`, and
`GATEWAY_UPSTREAM_TIMEOUT_MS`; each value must be a positive integer.

One gateway process starts with these fixed 60-second plans:

| Bucket                                             |      Limit |
| -------------------------------------------------- | ---------: |
| normalized login account                           |  10/minute |
| all login attempts                                 | 120/minute |
| all registrations                                  |  30/minute |
| each verified user's mutations                     |  60/minute |
| each verified user's matching/practice computation |  12/minute |

The expensive bucket is shared by both matching GET aliases, `POST /api/matches`, and
`POST /api/practice/locations/test`. Informational practice GETs and ordinary polling are outside
that bucket. A refusal returns 429 with an integer `Retry-After`; Task 22 owns the matching UI for
that response. Counters are per process and capped at 10,000 keys; move them to a shared limiter only
if deployment gains multiple gateway instances.

The Node server also fixes `headersTimeout=10s`, `requestTimeout=15s`, `keepAliveTimeout=5s`, and
`maxHeadersCount=64` while retaining the body and upstream limits above.

## 로컬 검증

```sh
cd Python && python -m uvicorn main:app --host 127.0.0.1 --port 8181
NODE_ENV=development GATEWAY_PUBLIC_ORIGIN=http://127.0.0.1:14200 PORT=8080 pnpm --filter @workspace/api-gateway run dev
pnpm --filter @workspace/api-gateway test
pnpm --filter @workspace/api-gateway test:shield
pnpm --filter @workspace/api-gateway typecheck
```

The package tests verify all 48 operations, every REST family's exact upstream method/path/query/body/
Cookie, auth/me recursion prevention, bodyless operations, 204 handling, public profile projection,
self-only PATCH, and retained negative HTTP boundaries.

For staging mutations, always send the configured external origin explicitly, including bodyless
operations:

```sh
curl -i -X POST -H 'Origin: https://classroom.example.com' https://classroom.example.com/api/auth/logout
curl -i -X POST -H 'Origin: https://classroom.example.com' https://classroom.example.com/api/requests/1/match
```

## Staging 증빙과 rollback

Record request time, deployment SHA, gateway correlation id, HTTP status, and observed upstream call
count. Exercise public, authenticated, query-bearing, bodyless, 204, unknown-route, malformed-path,
duplicate-header, and WebSocket upgrade cases. Verify separately that port 8181 is unreachable from
the public network. Local tests cannot prove hosting ingress configuration.

If the gateway is bypassed or the Python port is public, stop the release and deploy with
`GATEWAY_MAINTENANCE_MODE=true`. Maintenance mode keeps only `/livez` available and returns 503 for
registered REST routes and all WebSocket upgrades.

## Public response contract and generation

The public OpenAPI inventory is 48 REST operations. `pnpm api:generate` regenerates the
React client and Zod validators; `pnpm api:contract-test` compares those paths with the
compiled gateway policy and literal decorators in the routers included by `Python/main.py`.
It does not execute Python. `/livez` and `/readyz` are separate gateway operational endpoints.

Every API response uses `Cache-Control: no-store` and a gateway `X-Request-Id`. HTTP errors
expose only `{error:string}`; upstream diagnostics and debug headers are discarded, while
`Set-Cookie` is handled separately. HTTP-success learning results remain distinct: `status:todo`,
`success:false` with `data:null`, and successful data are preserved. Diagnostic error/message
text is replaced with fixed student-facing text. Existing `source:adapter-fallback` stays visible;
the gateway does not produce fallback data. Profile GET and self PATCH return only
`id`, `name`, `subjects`, and `createdAt`; admin rows omit email, district, and raw student results.
Wire timestamps remain JSON strings in both generated validators and gateway projection.

## WebSocket transport

WebSockets are counted separately from the 48 REST operations. Only GET upgrades at
`/ws/chat/rooms/{id}` and `/ws/dms/{id}` are tunneled; IDs must be canonical positive safe integers
and queries are forbidden. An exact configured Origin and a valid Cookie-backed Python session
are mandatory, including for the currently unfinished DM endpoint. Unknown paths and unauthorized
upgrades return 403; malformed handshakes return 400. Origin failures retain the fixed `forbidden`
error. Maintenance or shutdown drain returns 503 before authentication.

The gateway forwards Cookie, WebSocket handshake fields, and a newly generated X-Request-Id.
It validates the upstream 101 status, accept hash, Upgrade/Connection fields, and offered
subprotocol/extensions before exposing the upgrade. Session renewal and upstream Set-Cookie lines
remain separate. Non-101 4xx/5xx statuses are retained with a fixed public error, while malformed,
truncated, oversized, or unexpected success/redirect responses become 502. The error body is never
copied from Python. Handshakes, including session lookup and non-101 bodies, have a 5-second deadline
(504); non-101 bodies are limited to 16KiB. Early client bytes are bounded at 64KiB (413 on overflow).

Each gateway process allows 40 pending/active tunnels in total and two per verified user (429 on
excess), releasing counts on every exit. Idle tunnels close after 120 seconds without traffic.
Native stream backpressure handles slow peers; both initial head buffers are transferred once.
SIGINT/SIGTERM closes registered WebSockets through the gateway's `closeWebSockets()` method before
waiting for the HTTP server. The later readiness task extends this drain to the PostgreSQL pool.
Per-frame limits, moderation, message semantics, and participant authorization remain Python's
responsibility. Transport shutdown destroys sockets; the gateway does not parse or synthesize frames.
Multi-instance deployments require shared connection limits.

Vite dev and preview both proxy `/ws` with upgrades enabled to the same
`VITE_API_PROXY_TARGET` as `/api` (default `http://127.0.0.1:8080`). Configure
`GATEWAY_PUBLIC_ORIGIN` to the browser's exact serving origin. Production `/ws` remains owned by
the gateway artifact; Python port 8181 is private. ChatWidget continues REST polling.

Native synthetic-upstream tests cover successful/denied upgrades, session renewal, header and
body validation, head bytes, cancellation, deadlines, caps, backpressure, idle cleanup, and
independent gateway shutdown. Task 23 must still verify a real Python room and record the DM
learning-message-then-close behavior. Local transport tests do not establish provider ingress or
participant authorization correctness.

# API gateway 운영 절차

상태: 전체 학습 REST 계약 구현 완료. WebSocket과 production UI는 후속 작업 전까지 닫혀 있다.
소유자: Release manager(배포 승인과 증빙), Platform owner(네트워크 경계)

## 공개 경계

브라우저의 외부 API 진입점은 `artifacts/api-gateway` 하나다. Python backend는
`127.0.0.1:8181`에서 기존 업무 로직과 데이터 접근을 담당하며 직접 공개하지 않는다.
Gateway의 `GET /livez`는 upstream을 호출하지 않는 process liveness endpoint다.

REST 경로는 `src/route-policy.ts`의 48개 literal operation만 허용한다. 등록되지 않은
경로와 method는 404, malformed canonical path와 잘못된 query는 400으로 거부한다.
무제한 `/api/*` fallback은 없다. WebSocket upgrade는 계속 403
`websocket_unavailable`로 종료되며 Python에 연결하지 않는다.

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

| Route                                                                         | Allowed query                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/districts`                                                          | `type` is `high_school` or `unified`; `search` is at most 200 UTF-8 bytes                                                  |
| `GET /api/requests`                                                           | positive safe `districtId` and `tagId`; `role` is `mentor` or `mentee`; `status` is `open`, `matched`, or `closed`          |
| `GET /api/matches/{questionId}` and `GET /api/practice/matching/{questionId}` | `limit` from 1 through 20                                                                                                 |
| `GET /api/scheduling/suggest`                                                 | positive safe `user_a` and `user_b`; both required                                                                         |

POST/PATCH operations with a body require `application/json`. `POST /api/auth/logout`,
`POST /api/requests/{id}/match`, and every DELETE are bodyless. The default request limit is
1 MiB and the practice location test is capped at 16 KiB. Upstream response bodies default to
2 MiB. Request-body and upstream-response timeouts default to 10 and 5 seconds.

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
- Hop-by-hop, Server, Location, CORS, compression, and upstream content-length headers are stripped.
- Logs receive fixed event names, canonical paths, method, status, and correlation id, never Cookie,
  Authorization, request bodies, or upstream error details.

`GATEWAY_UPSTREAM_ORIGIN` must be a credential-free loopback HTTP origin. Limits can be reduced with
`GATEWAY_MAX_BODY_BYTES`, `GATEWAY_MAX_RESPONSE_BYTES`, `GATEWAY_BODY_TIMEOUT_MS`, and
`GATEWAY_UPSTREAM_TIMEOUT_MS`; each value must be a positive integer.

## 로컬 검증

```sh
cd Python && python -m uvicorn main:app --host 127.0.0.1 --port 8181
PORT=8080 pnpm --filter @workspace/api-gateway run dev
pnpm --filter @workspace/api-gateway test
pnpm --filter @workspace/api-gateway test:shield
pnpm --filter @workspace/api-gateway typecheck
```

The package tests verify all 48 operations, every REST family's exact upstream method/path/query/body/
Cookie, auth/me recursion prevention, bodyless operations, 204 handling, public profile projection,
self-only PATCH, and retained negative HTTP boundaries.

## Staging 증빙과 rollback

Record request time, deployment SHA, gateway correlation id, HTTP status, and observed upstream call
count. Exercise public, authenticated, query-bearing, bodyless, 204, unknown-route, malformed-path,
duplicate-header, and WebSocket upgrade cases. Verify separately that port 8181 is unreachable from
the public network. Local tests cannot prove hosting ingress configuration.

If the gateway is bypassed or the Python port is public, stop the release and deploy with
`GATEWAY_MAINTENANCE_MODE=true`. Maintenance mode keeps only `/livez` available and returns 503 for
registered REST routes.

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

WebSockets are counted separately: `/ws/chat/rooms/{id}` and `/ws/dms/{id}`. Task 18 adds
session/Origin-checked forwarding of these two paths. At the Task 16 boundary they are still
rejected before upstream connection. Python owns room/DM behavior; the current DM mission
sends its unfinished-learning message and closes, which subsequent forwarding must preserve.

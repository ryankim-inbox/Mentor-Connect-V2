# PeerBridge release surface

Status: the gateway exposes the approved 48-operation learning REST contract. Production UI feature
flags remain gated until the later UI release task, and WebSocket upgrades remain closed until the
dedicated WebSocket task. This intermediate state makes the REST boundary testable without claiming
that the complete browser experience or live WebSocket transport is released.

## Runtime boundary

The browser uses the same-origin gateway for `/api` and, after the later transport work, `/ws`.
The existing Python application remains the main backend on `127.0.0.1:8181`; the gateway validates
and forwards requests and does not replace Python matching, authorization, chat, scheduling, reports,
or database logic. Student-module success, error, empty, and incomplete responses pass through as real
learning outcomes rather than synthesized success data.

`GET /livez` is gateway-local. The REST allowlist contains exactly the operations in the approved
full-learning design:

- auth and account: register, login, logout, current account, and user profile GET/PATCH;
- discovery and requests: districts, tags, requests, Connect, reports, blocks, and statistics;
- learning features: matches, practice, analysis, analytics, Python reports, and scheduling;
- messaging REST: chat room/message and DM list/start/message operations;
- learning report: `GET /api/admin/flagged-users`;
- backend process health: `GET /api/healthz`.

The complete method/path/authentication/body/query table is maintained as the literal `publicRoutes`
array in `artifacts/api-gateway/src/route-policy.ts` and documented for operators in
`docs/runbooks/api-gateway.md`. Unregistered paths and methods have no forwarding fallback.

## Authentication and profile exposure

Public operations are register, login, district search/list, overview statistics, and health.
`GET /api/auth/me` requires a Cookie and is forwarded directly so it cannot recursively call itself.
Every other REST operation requires the gateway to verify the same Cookie against private
`/api/auth/me` before forwarding.

Any signed-in user may read another canonical `/api/users/{id}` profile. The gateway returns only
`id`, `name`, `subjects`, and `createdAt`; upstream email, bio, role, district, and verification fields
are removed. PATCH is still self-only, accepts only `name`, `bio`, and `subjects`, and returns an
existence-hiding 404 before the profile endpoint when the session id differs from the path id.
The authenticated user's own account response from `/api/auth/me` may include email; that does not
expand the cross-user profile contract.

## Canonical route and query policy

Dynamic ids are canonical positive safe integers. Practice raw module names are limited to
`find_matches`, `locations`, and `get_blocks`. Path percent encoding, backslashes, repeated slashes,
dot segments, uppercase variants, and trailing slashes are rejected before forwarding.

Only these query keys are accepted:

| Route                         | Contract                                                       |
| ----------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------- | ------- | ------- |
| `GET /api/districts`          | optional `type=high_school                                     | unified`; optional `search` no longer than 200 UTF-8 bytes |
| `GET /api/requests`           | optional positive `districtId`, positive `tagId`, `role=mentor | mentee`, `status=open                                      | matched | closed` |
| matching GET routes           | optional `limit` from 1 through 20                             |
| `GET /api/scheduling/suggest` | required positive `user_a` and `user_b`                        |

Malformed encoding, duplicates, unknown keys, empty numbers, zero, noncanonical integers, unsafe
integers, and out-of-range values return 400. Accepted queries are serialized and forwarded; omitted
optional values stay omitted so Python defaults apply.

JSON routes require `application/json`. Logout, Connect, and DELETE requests are forwarded without a
body. An upstream 204 is returned with no response body. General request bodies are limited to 1 MiB,
and `/api/practice/locations/test` is limited to 16 KiB.

## Controls that remain closed

WebSocket upgrade requests still return 403 before an upstream connection. The current production
browser flags and navigation remain gated until the later UI task verifies that the full learning
screens distinguish successful data, empty data, HTTP failures, student-module failures, and known
incomplete DM behavior. REST availability here is not evidence that those later release checks pass.

Unknown routes, wrong methods, invalid queries, malformed paths, duplicate headers, oversized bodies,
maintenance mode, unauthenticated session routes, and cross-user PATCH remain negative regressions.
Authentication-dependent GET responses use `Cache-Control: no-store` and `Vary: Cookie`.

## Verification

```sh
pnpm --filter @workspace/api-gateway test
pnpm --filter @workspace/api-gateway test:shield
pnpm --filter @workspace/api-gateway typecheck
```

Release approval also requires staging evidence that only the gateway is public, maintenance mode
fail-closes REST forwarding, and the Python port cannot be reached externally. UI, WebSocket,
readiness, error projection, rate limiting, contract generation, and final CI evidence are tracked by
their later release tasks and are not implied by this gateway policy change.

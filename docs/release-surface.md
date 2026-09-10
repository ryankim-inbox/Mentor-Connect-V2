# PeerBridge release surface

Status: Slice 03 admin/report quarantine, Slice 04 self-only profile policy,
Slice 05 matching/practice/Connect kill switch, and Slice 06 chat/DM/WebSocket
kill switch implemented (2026-09-02)

This document fixes the intended reduced release surface. The production
product currently supports sign-in, sign-out, session lookup, and self-profile
view/update for existing accounts. Account creation, landing statistics,
Dashboard, Districts, Requests, New Request, matching, practice, analytics,
scheduling, and messaging are unavailable. The client flags
reduce UI exposure; the TypeScript API Shield is the server-side boundary. A
staging deployment still needs to prove that the Python backend has no public
route before release approval.

## Feature flags

The single source of truth is
`artifacts/peerbridge/src/lib/release-flags.ts`.

All eight quarantined client features default to `false`. An explicit `true` value is
honored only by a Vite development server. Production builds ignore every
`VITE_FEATURE_*` value and remain closed.

| Feature                    | Development opt-in                      | Production default | Client exposure                                            | Data sensitivity                               | Server control                                                                                                                                | Owner                                         | Re-enable condition                                                                                                                                          |
| -------------------------- | --------------------------------------- | -----------------: | ---------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| District/request workspace | `VITE_FEATURE_CORE=true`                |              false | `/register`, `/dashboard`, `/districts/**`, `/requests/**` | Student identity, districts, and help requests | Only registration itself is allowlisted; required district/stats/request endpoints are denied, so the dependent UI is quarantined as one unit | Product API owner — assignment required       | Review and allowlist every required endpoint with authentication, authorization, response-schema, and data-sensitivity tests                                 |
| Admin tools                | Not supported; source and route removed |              false | Disabled `/admin/reports` deep link only                   | Moderation and PII                             | Gateway quarantines every route-family variant with a fixed 404 before auth or upstream                                                       | Release manager — assignment required         | Server-side admin identity, least privilege, audit log, and role E2E pass                                                                                    |
| Mentor matching            | `VITE_FEATURE_MATCHING=true`            |              false | `/recommendations`                                         | Student profile and eligibility data           | Gateway quarantines `/api/matches/**` before auth or upstream                                                                                 | Matching owner — assignment required          | Bidirectional block exclusion, report policy, verified-mentor filter, self-match prevention, atomic state transitions, concurrency, and tie-break tests pass |
| Practice lab               | `VITE_FEATURE_PRACTICE=true`            |              false | `/practice-lab`, `/dashboard/practice-lab`                 | Matching, location, and block test data        | Gateway quarantines `/api/practice/**` before auth or upstream                                                                                | Learning-platform owner — assignment required | The matching safety checklist and quarantine-removal review pass                                                                                             |
| Connect                    | `VITE_FEATURE_CONNECT=true`             |              false | Request-detail match action                                | Match state and contact information            | Gateway quarantines `/api/requests/*/match` before auth or upstream                                                                           | Matching owner — assignment required          | Safe match authorization, state-transition, concurrency, and rollback E2E pass                                                                               |
| Chat                       | `VITE_FEATURE_CHAT=true`                |              false | No production widget, navigation, or background work       | Messages, participants, and presence           | Gateway quarantines `/api/chat/**`, `/api/dms/**`, and `/ws/**` before upstream; upgrades receive 403                                         | Messaging owner — assignment required         | Authenticated room creation, participant-only reads, WS session verification, persistence, XSS, spam, rate-limit, and E2E pass                               |
| Analytics                  | `VITE_FEATURE_ANALYTICS=true`           |              false | `/analytics`                                               | Aggregate and mentor response data             | None yet; Slice 02 required                                                                                                                   | Analytics owner — assignment required         | Approved aggregate schema, access policy, and response redaction pass                                                                                        |
| Scheduling                 | `VITE_FEATURE_SCHEDULING=true`          |              false | `/scheduling`                                              | Student availability data                      | None yet; Slice 02 required                                                                                                                   | Scheduling owner — assignment required        | Self-only / approved matching access policy and response schema pass                                                                                         |

An unassigned owner is a release blocker for re-enabling that feature.

## Enforced external API policy

Client route classification is defined in `release-flags.ts`. The runtime API
allowlist and quarantine live in `artifacts/api-gateway/src/gateway.ts` and
`route-policy.ts`, so endpoint names for quarantined data are not emitted in
the production browser bundle.

### Enforced allowlist

- `GET /livez` (gateway local response)
- `GET /api/healthz`
- `POST /api/auth/register` (the dependent production registration UI remains quarantined)
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET/PATCH /api/users/{self}` after gateway session/identity validation

Authentication-dependent GET outcomes are gateway-forced to
`Cache-Control: no-store` and a de-duplicated `Vary` containing `Cookie`,
independent of upstream cache headers.

### Denylist

- `/api/admin/**`
- `/api/python-reports/**`
- `/api/matches/**`
- `/api/practice/**`
- `/api/requests/*/match`
- `/api/chat/**`
- `/api/dms/**`
- `/ws/**`
- `/api/users/{id}` when `id` is not the session user
- Every route absent from the approved API contract

### Slice 03 admin/report quarantine

- Every method for the admin and Python-report route families is classified
  before URL parsing, header validation, authentication, request-body reading,
  or an upstream request. Encoded separators, repeated decoding, trailing
  slashes, matrix parameters, dot segments, backslashes, and case variants are
  included in the comparison.
- The external response is the constant `404 {"error":"not_found"}` with
  `Cache-Control: no-store`; response body and size do not vary by session,
  user existence, or flagged-row count. The correlation value is available only
  in the `X-Request-Id` header.
- The `gateway.quarantine_denied` security metric contains only `routeFamily`,
  `correlationId`, `outcome`, and `status`. It does not receive the raw path,
  cookie, authorization header, request body, or user data.
- `AdminReports.tsx`, its router entry, its analytics navigation entry, and its
  queries are removed. The production bundle therefore contains no calls to
  either quarantined API family.

Verification:

```sh
pnpm --filter @workspace/api-gateway test
pnpm --filter @workspace/peerbridge run build
rg -n "/api/admin|/api/python-reports" artifacts/peerbridge/dist
```

### Slice 04 profile PII self-only policy

- The API Shield accepts GET and PATCH only for the exact canonical
  /api/users/{id} form, after the session user id from /api/auth/me matches
  the path id. Anonymous requests receive 401; a different session user's id
  receives the existence-hiding 404. In both cases the profile endpoint is not
  called upstream.
- The self profile response is explicitly redacted to id, name, subjects, and
  createdAt. Email, district data, bio, role, and verification fields never
  leave the gateway through this route, including after PATCH.
- PATCH reads and validates JSON before session verification so forbidden keys
  such as id, email, role, is_verified, and arbitrary extra fields produce a
  400 without any upstream request. Only name, bio, and subjects are sanitized
  and forwarded.
- The browser has one self-profile route, /profile. Former routes and links
  that accepted another user's identifier have been removed, and the settings
  form no longer presents a role mutation or requests the block-list endpoint.
- The public OpenAPI contract names the response SelfProfile and removes role
  from UpdateUserBody. Generated React and Zod clients therefore describe the
  gateway contract rather than the broader internal Python response.

Verification:

    pnpm --filter @workspace/api-gateway test
    pnpm --filter @workspace/api-gateway typecheck
    pnpm --filter @workspace/api-spec run codegen
    pnpm --filter @workspace/peerbridge typecheck
    ! rg -n "/profile/" artifacts/peerbridge/src --glob "*.tsx"

### Slice 05 matching, practice, and Connect kill switch

- Every HTTP method for `/api/matches/**`, `/api/practice/**`, and
  `/api/requests/*/match` receives the same fixed 404 before URL parsing,
  authentication, request-body reads, or an upstream request. The route policy
  resolves repeated percent encoding, slash and backslash variants, matrix
  parameters, dot segments, trailing slashes, and case variants before it
  classifies a route family.
- The coarse `routeFamily` metric is one of `matches`, `practice`, or
  `request-match`; it intentionally excludes IDs, query values, cookies, and
  candidate data. A request containing a blocked mentor ID is therefore
  indistinguishable from any other quarantined request and cannot reveal a
  candidate list or existence.
- Recommendations, Practice Lab, and the Connect mutation are imported only
  behind Vite's compile-time development branch. Production emits no matching
  page chunk or `/api/matches`, `/api/practice`, or `/match` request string.
  A disabled Connect control says only that the feature is temporarily
  unavailable; it never reveals a user's blocked, reported, or verification
  state. Existing match records are not deleted or changed.

Re-enable checklist:

- Prove bidirectional block exclusion and the report policy.
- Filter to verified mentors and prohibit self-matches.
- Define and test valid state transitions, including atomicity, concurrency,
  rollback, and deterministic tie-break behavior.
- Remove the gateway quarantine only in a separately reviewed release with
  matching authorization and end-to-end regression tests.

Verification:

```sh
pnpm --filter @workspace/api-gateway test
pnpm --filter @workspace/api-gateway test:shield
pnpm --filter @workspace/peerbridge typecheck
pnpm --filter @workspace/peerbridge build
rg -n "/api/(matches|practice)|/match" artifacts/peerbridge/dist
```

### Slice 06 chat, DM, and WebSocket kill switch

- Every ordinary HTTP method for `/api/chat/**`, `/api/dms/**`, and `/ws/**` is
  classified before URL parsing, header validation, authentication,
  request-body reads, or an upstream request. Encoded separators, repeated
  decoding, slash and backslash variants, matrix parameters, dot segments,
  trailing slashes, and case variants use the same normalization as the other
  quarantined families. Upgrade requests take the separate unconditional 403
  path before any upstream connection can be created.
- Anonymous and authenticated HTTP requests receive the fixed 404
  `{"error":"not_found"}`. The `gateway.quarantine_denied` metric records only
  the coarse `chat`, `dms`, or `websocket` family plus its normal correlation
  fields. The gateway tests assert that the upstream request/connection count
  for every chat, DM, and non-upgrade WebSocket request is zero.
- Every HTTP Upgrade request ends as `403 {"error":"websocket_unavailable",…}`
  before an upstream connection is possible. It emits `gateway.upgrade_denied`
  with the coarse `websocket` route family; it never negotiates a WebSocket
  session or forwards credentials upstream.
- `ChatWidget` is loaded only through a Vite development-only lazy import.
  Consequently production has no chat widget or navigation, no chat polling or
  reconnect loop, and no chat module to emit console errors or requests. The
  disabled UI has no `localStorage` or `sessionStorage` use, so it cannot retain
  a browser message draft.
- This kill switch does not delete or alter any chat room, DM, or message data.
  Feature disablement is not a data-retention or deletion policy; any retention
  change requires its own reviewed, approved data operation.

Re-enable checklist:

- Authenticated room creation and participant-only room/DM reads pass.
- WebSocket session verification and message persistence pass.
- XSS handling, spam controls, rate limiting, and end-to-end coverage pass.
- A separately reviewed change removes the gateway quarantine and restores the
  production module only after the preceding checks have evidence.

Verification:

```sh
pnpm --filter @workspace/api-gateway test
pnpm --filter @workspace/api-gateway test:shield
pnpm --filter @workspace/peerbridge typecheck
pnpm run test:peerbridge-release
pnpm --filter @workspace/api-gateway exec tsx --test ../peerbridge/test/release-surface.test.ts
```

## Client behavior while a feature is disabled

- Risky routes are classified before the global authentication provider mounts.
  They show a "being prepared" message with a return-to-home link; neither the
  feature page nor the global `/api/auth/me` query mounts for a direct visit.
- The navigation hides disabled feature links. The development-only dashboard
  omits the practice tab and successful-match metric unless those features are
  explicitly enabled; production does not load Dashboard at all.
- The former admin page is not in the router or production build. Its disabled
  deep link is classified before `AuthProvider` mounts, so it cannot create an
  admin/report query.
- Matching and practice deep links are likewise classified before
  `AuthProvider` mounts. Their production routes show the same safe
  unavailable state, while the development-only page modules and Connect
  mutation are excluded from the production bundle.
- The chat widget is absent from the production build, so it cannot start
  polling, reconnecting, navigating, or storing a draft in browser storage.
- The Connect action and recommendation match-request entry point are absent
  from production.
- Core district/request/registration pages and analytics/scheduling pages use
  development-only imports, so their denied endpoint strings are absent from
  the production artifact. Dashboard, Districts, Requests, New Request, and
  registration direct links show the same pre-auth unavailable state.
- The landing page makes no stats/district/request call and describes only the
  usable reduced product. Successful login and authenticated home navigation
  go to `/profile`; production navigation exposes only profile, settings, and
  logout for a signed-in account.

The repeatable `pnpm run test:peerbridge-release` gate rebuilds production and
scans the emitted artifact for every endpoint outside this reduced client
surface. `.github/workflows/release-surface.yml` runs the same gate for pull
requests and pushes to main.

## Release constraints and rollback

This implementation does not by itself authorize a release. If a regression is
found, retain the gateway's maintenance-deny posture and rebuild from a commit
where every `VITE_FEATURE_*` value remains disabled. Staging must additionally
verify that the Python process is reachable only over its private loopback port.

# PeerBridge release surface

Status: Slice 03 admin/report quarantine, Slice 04 self-only profile policy,
and Slice 05 matching/practice/Connect kill switch implemented (2026-08-26)

This document fixes the intended reduced release surface. The client flags
reduce UI exposure; the TypeScript API Shield is the server-side boundary. A
staging deployment still needs to prove that the Python backend has no public
route before release approval.

## Feature flags

The single source of truth is
`artifacts/peerbridge/src/lib/release-flags.ts`.

All seven risky client features default to `false`. An explicit `true` value is
honored only by a Vite development server. Production builds ignore every
`VITE_FEATURE_*` value and remain closed.

| Feature | Development opt-in | Production default | Client exposure | Data sensitivity | Server control | Owner | Re-enable condition |
|---|---|---:|---|---|---|---|---|
| Admin tools | Not supported; source and route removed | false | Disabled `/admin/reports` deep link only | Moderation and PII | Gateway quarantines every route-family variant with a fixed 404 before auth or upstream | Release manager — assignment required | Server-side admin identity, least privilege, audit log, and role E2E pass |
| Mentor matching | `VITE_FEATURE_MATCHING=true` | false | `/recommendations` | Student profile and eligibility data | Gateway quarantines `/api/matches/**` before auth or upstream | Matching owner — assignment required | Bidirectional block exclusion, report policy, verified-mentor filter, self-match prevention, atomic state transitions, concurrency, and tie-break tests pass |
| Practice lab | `VITE_FEATURE_PRACTICE=true` | false | `/practice-lab`, `/dashboard/practice-lab` | Matching, location, and block test data | Gateway quarantines `/api/practice/**` before auth or upstream | Learning-platform owner — assignment required | The matching safety checklist and quarantine-removal review pass |
| Connect | `VITE_FEATURE_CONNECT=true` | false | Request-detail match action | Match state and contact information | Gateway quarantines `/api/requests/*/match` before auth or upstream | Matching owner — assignment required | Safe match authorization, state-transition, concurrency, and rollback E2E pass |
| Chat | `VITE_FEATURE_CHAT=true` | false | Floating chat widget | Messages, participants, and presence | None yet; Slice 02/06 required | Messaging owner — assignment required | Participant authorization, persistence, XSS, spam, and WebSocket E2E pass |
| Analytics | `VITE_FEATURE_ANALYTICS=true` | false | `/analytics` | Aggregate and mentor response data | None yet; Slice 02 required | Analytics owner — assignment required | Approved aggregate schema, access policy, and response redaction pass |
| Scheduling | `VITE_FEATURE_SCHEDULING=true` | false | `/scheduling` | Student availability data | None yet; Slice 02 required | Scheduling owner — assignment required | Self-only / approved matching access policy and response schema pass |

An unassigned owner is a release blocker for re-enabling that feature.

## Enforced external API policy

Client route classification is defined in `release-flags.ts`. The runtime API
allowlist and quarantine live in `artifacts/api-gateway/src/gateway.ts` and
`route-policy.ts`, so endpoint names for quarantined data are not emitted in
the production browser bundle.

### Allowlist candidates

- `GET /api/healthz`
- `GET /livez`
- Gateway-validated minimum authentication paths
- `GET/PATCH /api/users/{self}`
- Explicitly approved non-sensitive reference data

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

## Client behavior while a feature is disabled

- Risky routes are classified before the global authentication provider mounts.
  They show a "being prepared" message with a return-to-home link; neither the
  feature page nor the global `/api/auth/me` query mounts for a direct visit.
- The navigation hides disabled feature links, the dashboard omits the practice
  tab and successful-match metric, and the landing page omits the
  successful-match metric.
- The former admin page is not in the router or production build. Its disabled
  deep link is classified before `AuthProvider` mounts, so it cannot create an
  admin/report query.
- Matching and practice deep links are likewise classified before
  `AuthProvider` mounts. Their production routes show the same safe
  unavailable state, while the development-only page modules and Connect
  mutation are excluded from the production bundle.
- The chat widget is not mounted, so it cannot start polling.
- The Connect action and recommendation match-request entry point are absent
  from production.

## Release constraints and rollback

This implementation does not by itself authorize a release. If a regression is
found, retain the gateway's maintenance-deny posture and rebuild from a commit
where every `VITE_FEATURE_*` value remains disabled. Staging must additionally
verify that the Python process is reachable only over its private loopback port.

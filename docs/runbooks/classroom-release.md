# Classroom release

This procedure publishes one PeerBridge classroom release. Repository checks do not deploy anything,
inspect a production database, or prove provider configuration. Keep every item below as `unknown`
until the named evidence exists.

## Release inputs

Before starting, record the release commit, exact HTTPS origin, approved backup reference, and previous
immutable release reference. The deployment must use the three production artifacts in one application
router: the static frontend owns `/`, the gateway owns `/api`, `/livez`, `/readyz`, and `/ws`, and the
Python artifact has `paths = []`, binds `127.0.0.1:8181`, and is reachable only by the gateway.

For this non-Python release track, the implementation baseline is
`98e1b04c292302bd25365ed7db4c5675671df337`. The release command also checks the pull request base.
These two freeze checks are scoped to `codex/learning-tasks-21-24`; they are not a repository-wide ban
on later student Python assignments.

```sh
export RELEASE_SHA="$(git rev-parse HEAD)"
export PYTHON_PR_BASE="$(git merge-base HEAD origin/main)"
pnpm verify:release
```

The command installs from the frozen lockfile, typechecks, builds the release, runs gateway, migration,
disposable PostgreSQL, frontend unit, contract, boundary, secret, smoke self-tests, and browser tests in
the CI order, then verifies both Python baselines. A code-generation diff is a failure: commit the
generated clients in their own reviewed change and rerun the whole command. Database tests create and
destroy runner-owned PostgreSQL 16 clusters; do not point them at a shared or deployed database.

CI separately runs and retains both `pnpm audit --prod --audit-level high --json` and the complete
`pnpm audit --audit-level high --json` report. High or critical findings in the frontend build, Vite,
Orval/code-generation, or another release path block release. Do not treat an unknown path as an
exception. If a finding is reachable only from the development-only mockup artifact, record the exact
package version, dependency path, evidence that the artifact has no production service, owner, and
review date before excluding it. The current dependency remediation record reports no exclusions.

## Provider configuration

In Replit Publishing, keep the application router and PostgreSQL 16. Autoscale is the only deployment
target recorded in `.replit`. Set **Max machines to 1** until the deployed WebSocket routing and shared
session behavior have been verified. A Reserved VM is also a documented one-machine option, but no
verified `.replit` enum is available; select it only through the provider UI if the operator chooses it.
Record the final deployment type, machine count, and evidence reference. Do not add a second backend,
CDN, or direct Python route.

The static artifact format used by this application router has no verified arbitrary response-header
setting. The HTML CSP meta policy can enforce the supported document policy, but it does not establish
HSTS or `frame-ancestors`. At the actual HTTPS ingress, configure and verify these response headers:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
Strict-Transport-Security: max-age=31536000; includeSubDomains
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

The gateway already sets `X-Content-Type-Options: nosniff`; do not add a duplicate implementation.
If the selected ingress cannot set the required headers, record that result and keep the release
blocked or choose an already-approved deployment option that can. A CSP meta tag is not evidence for
HSTS, `frame-ancestors`, or Permissions Policy.

## External boundary and smoke checks

Use two synthetic classroom accounts and a credential file restricted to mode `0600`. The smoke tool
requires the exact same HTTPS value in `CLASSROOM_ORIGIN` and `SMOKE_ALLOWED_ORIGIN`; it emits bounded
status records and does not retain raw response bodies.

```sh
CLASSROOM_ORIGIN="https://CLASSROOM_HOST" \
SMOKE_ALLOWED_ORIGIN="https://CLASSROOM_HOST" \
CLASSROOM_CREDENTIAL_FILE="/secure/classroom-smoke.json" \
node scripts/smoke-classroom.mjs > "/secure/evidence/smoke-${RELEASE_SHA}.jsonl"
```

Confirm every desktop and mobile menu destination is reachable. With the synthetic accounts, verify
registration followed by Dashboard, Requests filters, another user's minimal profile and rejected
cross-user edit, Connect, persisted room chat, the DM learning state, and matching, analytics, and
scheduling learning results. A student-module `todo`, syntax/import/runtime error, or invalid output is
recorded as a visible learning state with retry where applicable; it does not hide the page or become a
false success. Transport, authorization, and gateway failures are release failures.

Check the following at the public origin:

- `/livez` and `/readyz`; readiness must be 200 before traffic is accepted.
- both authenticated WebSocket handshakes: `/ws/chat/rooms/{id}` and `/ws/dms/{id}`.
- login's session cookie has `Secure`, `HttpOnly`, and the expected SameSite policy over HTTPS.
- a real SPA deep link returns the application shell, while a missing asset returns 404.
- an unregistered `/api/...` path returns the gateway's bounded 404 and never HTML 200.
- the four ingress headers above are present with the recorded values.

From an approved external probe, perform read-only connection attempts against the deployment's known
alternate host mappings for ports 8181, 8000, 8081, and 21288. Record each resolved hostname/port and
result. Port 8181 is the private current backend; 8000 is the legacy development backend; 8081 is the
mockup preview; 21288 is the frontend development service. None may provide an alternate public API or
Python path. Also inspect the provider's actual host/port mapping because a closed conventional port
does not prove an alternate mapping is absent. Do not send mutating requests during this check.

```sh
curl --silent --show-error --head --connect-timeout 5 "https://CLASSROOM_HOST:8181/api/healthz"
curl --silent --show-error --head --connect-timeout 5 "https://CLASSROOM_HOST:8000/api/healthz"
curl --silent --show-error --head --connect-timeout 5 "https://CLASSROOM_HOST:8081/__mockup"
curl --silent --show-error --head --connect-timeout 5 "https://CLASSROOM_HOST:21288/"
curl --silent --show-error --head "$CLASSROOM_ORIGIN/"
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$CLASSROOM_ORIGIN/assets/missing-release-canary.js")" = 404
test "$(curl --silent --output /dev/null --write-out '%{http_code}' "$CLASSROOM_ORIGIN/api/not-in-contract")" = 404
```

The four alternate-port commands are expected to be unreachable or to return no application service.
If the provider publishes named alternate hosts instead of these ports, probe those exact mappings as
well. Inspect the unknown API response headers separately and fail if its content type or body is the
SPA document.

## Release record and decision

Store a release record with all of these fields. A blank field is `unknown`, not a pass.

```text
commitSha:
distDigest:
runtimeLockDigest:
gatewayPolicyDigest:
schemaVersion:
origin:
backupReference:
smokeSummary:
previousReleaseReference:
providerDeploymentType:
providerMachineCount:
webSocketRoutingEvidence:
ingressHeaderEvidence:
externalBoundaryEvidence:
```

Compute digests from the exact deployed release checkout and built files. `schemaVersion` comes from
`database/schema/version.json`. Record the smoke summary as counts of pass, learning-incomplete, and
transport-failure plus its protected evidence reference; do not copy credentials, cookies, raw bodies,
or database URLs into the record.

Approve the classroom release only after all required routes, sessions, chat persistence, gateway
boundaries, readiness, headers, and both WebSocket handshakes pass. Keep DM and student matching,
analytics, or scheduling errors in the exposed assignment-state list.

## Rollback

Startup or database failure, secret exposure, gateway bypass, direct Python exposure, wrong-origin
session behavior, or repeated transport failure requires rollback. Switch to the previous immutable
artifact reference. If that cannot be done safely, set `GATEWAY_MAINTENANCE_MODE=true` on the gateway
and confirm REST and WebSocket forwarding fail closed while `/livez` remains available for diagnosis.

Do not expose Python directly during rollback and do not downgrade the schema automatically. If data
restore is required, follow the separately approved database restore procedure and its backup evidence.
Record the trigger, operator, time, previous release reference, maintenance result, and restore reference
in the release record.

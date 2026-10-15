# Render Free + fresh Neon test database

Status: local implementation only. A production URL has not been deployed or verified.

## Architecture and boundaries

`Dockerfile` builds the React SPA and TypeScript gateway with Node 24/pnpm 10.33.0 and uses Python 3.12 + `uv sync --frozen --no-dev` from `uv.lock`. The root `requirements.txt` is not the runtime lock. `release.json` still records the build SHA and expected migration ID. Render supplies `RENDER_GIT_COMMIT` as a Docker build argument; local builds must pass `RELEASE_SHA`.

The gateway serves HTTP/API/WS on Render's `PORT` (default 10000). FastAPI runs exactly one worker at 127.0.0.1:8181. `ops/run-service.py` supervises both children and exits if either dies; SIGTERM drains both. No migrations or fixtures run on startup. No volumes, cron, shell, predeploy job, Redis, or LISTEN/NOTIFY are required. Do not scale instances/workers: the live socket registry is process-local.

Only known client routes receive SPA fallback. Missing API/WS/asset paths and unknown routes remain errors. Hashed assets are immutable; HTML revalidates. Security headers include CSP, frame protection, nosniff, referrer policy, and HSTS for HTTPS origins.

REST send is canonical. Only a committed row schedules broadcast. Each broadcast rechecks current recipients' membership/district/block permission; slow sockets are bounded. Browser WS connections receive events and invalidate REST history rather than append frames directly. First open fetches the latest 50 messages. Reconnect, becoming visible, and returning online page backwards with `beforeId` until the previously displayed history is recovered, including gaps exceeding 50 messages. The cursor uses the channel-scoped `(created_at, id)` ordering, not ID order alone. “Load older messages” retrieves another 50; refresh/relogin start at the newest page, with older messages still available. Each page rechecks access and excludes deleted rows. A 60-second repair poll runs while connected; fallback polling retains error backoff. The UI never sends a text ping or automatically retries an uncertain mutation. Uvicorn handles protocol-level ping/pong. A timeout may mean a message was saved: check history before manually sending again. Long displayed histories and large gaps require multiple REST requests, so monitor Free DB/egress usage.

## Required operator approvals and login

Before any remote write, obtain explicit approval for:

1. Push `codex/render-neon-deployment` to `ryankim-inbox/Mentor-Connect-V2` and create a draft PR against `main`. This publishes the reviewed code/config/tests/runbook only. No force push and no automatic merge.
2. Browser login to Render and Neon was confirmed on 2026-10-15. Reconfirm access if the session expires. Never put passwords, OTPs, tokens or DB URLs in chat, git, screenshots, or logs. A fresh OAuth grant, broader GitHub scope, persistent API token, or credential creation is a separate approval step.
3. Create a **new Free Neon project and empty test database**. The pending UI proposes `Mentor_Connect` in AWS Ohio; nothing has been created. Confirm the exact project, host, database name and region, and choose a nearby/matching Render region. Do not branch/copy an existing DB or import legacy dumps. Creating credentials, application/readiness roles, or storing DB URLs is a security-sensitive approval step.
4. Create one **Free Render Docker web service**, connect only this repository/approved branch, save its exact HTTPS origin and required environment variables, and deploy the approved commit. Confirm no paid resources, previews, disks or additional workers appear in the final review screen.

`render.yaml` explicitly selects `plan: free`, one instance, `/readyz`, and disables automatic deploys. The Blueprint's initial creation can still deploy immediately: approval must precede applying it. `SESSION_SECRET` is generated once in Render; keep the existing value across releases. Do not regenerate it on restart.

## Database and environment setup (after approval)

Use TLS with certificate validation and URL-encoded credentials. Python `DATABASE_URL` can retain Neon's `channel_binding=require`. Node `pg` does **not** implement that libpq URL requirement: bootstrap/readiness URLs must use `sslmode=verify-full` without `channel_binding`. The existing bootstrap validator intentionally rejects unsupported options rather than silently claiming to enforce them. Never solve that error by disabling TLS or certificate verification.

| Variable | Destination / meaning |
| --- | --- |
| `DATABASE_URL` | Render secret: application role, new Neon DB; pooled endpoint is suitable |
| `READINESS_DATABASE_URL` | Render secret: role with CONNECT, schema USAGE, and SELECT on `public.mentor_connect_schema_migrations`; no app-table writes |
| `SESSION_SECRET` | Render persistent secret, random >=32 characters; generated once |
| `GATEWAY_PUBLIC_ORIGIN` | Exact `https://<service>.onrender.com` origin, no trailing slash/path |
| `CLASSROOM_DATABASE_URL` | Local operator environment only: direct endpoint / bootstrap owner, new empty DB |
| `CLASSROOM_ALLOWED_HOST` | Exact direct hostname approved for this test project |
| `CLASSROOM_DATABASE_NAME` | Exact newly created DB name |
| `CLASSROOM_APP_SHA` | Full reviewed commit SHA used for bootstrap ledger |

Do not reuse application-role credentials for readiness in the real environment. The local disposable integration test intentionally uses one test role. Keep bootstrap owner credentials local and ephemeral; do not save them on Render.

With the approved direct URL and exact host/name loaded through secure local environment input (not a pasted command containing secrets):

```sh
pnpm install --frozen-lockfile
node ops/bootstrap-classroom.mjs
```

The bootstrap holds a transaction/advisory lock, rejects a populated target, checks schema assets, and applies migrations 0001–0003. Run once, before deployment. Do not rerun bootstrap on populated targets and do not use `dummy_DB.sql`, `Python.zip`, `Python/create_tables.sql`, or legacy fixtures. Future migrations need a separate operator step and approval.

`ops/seed-classroom.mjs` provides guarded, synthetic base districts/rooms and two randomly passworded accounts through registration; it writes a 0600 credential file. Its default pair share a district. For the full negative live test, prepare two **new synthetic validation accounts in different seeded districts** plus a third unrelated account through the test site's registration UI. Add their IDs to a separate 0600 credential file. Do not change existing real users or paste generated passwords into chat. Signup only checks the `.edu` suffix; it does not verify email ownership. This deployment is test-only, unsuitable for real students or sensitive data.

## Health and free limits

`/livez` checks gateway liveness. `/readyz` checks Python health and the expected migration ledger in a read-only transaction. Probes share work/cache for 2 seconds; the total deadline is 8 seconds, DB connection timeout 6 seconds and query timeout 1 second. A cold Neon wakeup longer than that returns 503; the next probe retries. A real cold Neon wakeup must still be timed after five minutes of DB inactivity. Do not claim local delays prove provider latency.

Checked 2026-10-15: [Render Free](https://render.com/docs/free) sleeps after 15 idle minutes, has 750 shared instance-hours/month and no free shell/one-off jobs/persistent disk. Its [Free compute](https://render.com/docs/blueprint-spec) is 0.1 CPU/512 MB. [Neon Free](https://neon.com/docs/introduction/plans) includes 100 CU-hours/project/month, 1 GB storage and 5 GB public egress; compute sleeps after 5 minutes idle. Check the workspace's current outbound/build allowances and spend limits before deployment (planned baseline: 5 GB outbound/500 build minutes). Render can bill supplementary bandwidth/build usage when a payment method exists. Keep Free selected and inform the user before any paid choice.

Readiness queries and connected chats can keep Neon awake. Avoid synthetic keepalive monitors and close test chats when unused. Review both usage dashboards; stop/suspend testing rather than upgrade without consent. This architecture has no always-on guarantee.

## Local verification

Node 24, pnpm 10.33.0, uv 0.11.16, Python 3.12, PostgreSQL tools, OpenSSL and Playwright Chromium are required. The Python runner creates a disposable /tmp cluster; it never reads the checkout's `.env` for a DB target.

```sh
uv sync --frozen --group dev
pnpm build:release
pnpm test:gateway
pnpm --filter @workspace/peerbridge test:unit
sh scripts/test-python.sh
pnpm e2e
# Real backend + migrated empty DB + two contexts + local TLS + process restart:
sh scripts/test-python.sh tests/test_deployment_live.py -q -rP
# Local Docker, with a 512 MiB memory limit and 0.1 CPU, no swap allowance:
docker build --build-arg RELEASE_SHA="$(git rev-parse HEAD)" -t mentor-connect:render-local .
DEPLOYMENT_TEST_IMAGE=mentor-connect:render-local sh scripts/test-python.sh tests/test_deployment_live.py -q -rP
```

The local TLS harness alone trusts its self-signed certificate; the live CLI uses normal certificate verification. Container mode uses Docker Desktop's `host.docker.internal` to reach the disposable host DB and records cgroup `memory.peak`. ARM64 local results do not certify Render's amd64 image: build/test `--platform=linux/amd64` or verify on Render before sign-off. Linux ARM64 native Rollup/Tailwind/Lightning CSS dependencies are retained in the lockfile for local Docker builds.

Local results on 2026-10-15: ARM64 and AMD64 images both built successfully. The ARM64 image passed the two-browser HTTPS/restart test with 512 MiB memory, no additional swap and 0.1 CPU; measured peaks were 197.1 MiB before restart and 112.2 MiB after restart. AMD64 runtime, real provider cold starts and larger workloads remain unverified. Existing Google Fonts requests are blocked by the self-hosted CSP; the UI uses its system font fallback.

There is no repository lint script. Run typecheck, `git diff --check`, the repository's secret scanner and relevant tests; report any omitted gates separately.

## Actual HTTPS validation and restart evidence

Credential file (mode 0600, outside repo) must contain `accounts.mentor` and `accounts.mentee` with `id`, `email`, `password`; `fixtures` with `questionId`, `globalRoomId`, `districtIds` and `outsiderUserId`. The two primary accounts must have different districts; the outsider must not be either participant. All are synthetic users on this new test DB. Do not reuse known fixture passwords.

After the exact HTTPS deployment origin is approved and configured:

```sh
# Set CLASSROOM_ORIGIN, SMOKE_ALLOWED_ORIGIN to the SAME exact HTTPS origin.
# Set CLASSROOM_CREDENTIAL_FILE to the 0600 file; do not echo it.
# Set LIVE_CHAT_EVIDENCE_FILE to a new local filename outside the repo.
node scripts/smoke-live-chat.mjs
```

The runner checks independent sessions, deep links/404/readiness, bidirectional room/DM UI delivery, 51-message offline gaps in both room and DM, history pagination/dedup, membership/district/block/Origin/sender guards, reload and relogin. It sends uniquely labeled synthetic messages and removes only the block it creates; messages remain as persistence canaries. It reports restart validation as **pending**, never silently passed.

Perform one approved Render service restart/redeploy, then run against the same origin and evidence file:

```sh
LIVE_CHAT_VERIFY_PERSISTENCE=1 node scripts/smoke-live-chat.mjs
```

Also check unauthorized/hostile-Origin WS handshakes using the gateway regression cases, a real idle Render wakeup, cold Neon readiness timing, secure HttpOnly session cookies, and Render memory/CPU graphs. Record actual URL, full SHA, time, two-account outcomes, restart evidence, cold-start timings and any remaining failures. Deployment is complete only after these checks pass on the real HTTPS URL.

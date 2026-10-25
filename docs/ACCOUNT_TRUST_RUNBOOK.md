# Account ownership and administrator rollout

Current contest-demo member policy: ordinary authenticated accounts no longer need
mailbox ownership proof to use member features. See [demo member access](TEST_MEMBER_ACCESS.md).
Actual ownership-proof requirements remain in force. The single-account contest
demo administrator exception and its separate activation approval are documented
in [demo member access](TEST_MEMBER_ACCESS.md#administrator-preparation); the older
administrator rollout below describes the normal verified-admin route.
Migration-era member-gating statements below describe the older rollout, not the
current member policy. This policy change needs no new schema migration.

This branch implements account ownership and an explicitly enabled, single-recipient Resend test adapter. It is not ready for deployment: delivery defaults to disabled, actual inbox proof is pending and no administrator has been provisioned. The user authorized PR work, native AMD64 CI and scoped mail/DB/redeployment preparation. Resend testing and one exact recipient were selected privately; see [mail setup and limits](MAIL_PROVIDER_OPTIONS.md). No remote migration, actual mail or deployment step below has been performed. Do not merge main or broaden the targets beyond existing Neon `purple-pond-78194407/neondb` and Free Render `mentor-connect-test`.

## Before any future deployment

1. Obtain explicit approval for the target environment, maintenance window, backup/restore procedure, migration and the individual administrator account. Complete review of the Resend test adapter, credential approval and secure user entry. Configure the application's trusted origin. Prove actual inbox receipt and same-account confirmation in an isolated new-schema rehearsal before resetting existing ownership. The old deployed app cannot confirm a new-flow link.
2. Back up the target database and rehearse restoration. Review migration 0006 and the exact installed migration ledger. Migrations 0001–0005 are immutable.
3. Coordinate a maintenance rollout of Python, gateway, generated contracts and UI. Migration 0006 resets all legacy ownership flags, adds `email_verified_at` and `is_admin`, and enforces consistency between timestamp proof and `is_verified`. Old registration code writes `is_verified=true` without proof and is incompatible after migration. Stop old application writers before applying it; do not use a rolling overlap with the old registration implementation.
4. Define and independently review the remote migration/grant procedure. The current `ops/upgrade-account-trust.mjs` intentionally accepts only disposable loopback databases named `account_trust_upgrade_*`. It is a rehearsal tool and must not be repurposed into a remote migration by changing its safeguards. A separately authorized, reviewed remote path is a deployment prerequisite. The shared role policy now narrows existing users INSERT/UPDATE to runtime columns and denies administrator writes; see [grant and version-matched recovery](runbooks/account-trust-recovery.md).
5. Apply the coordinated release during maintenance and verify migration ledger/catalog, ownership consistency, readiness and rollback readiness before reopening registration. The application role needs the reviewed token/attempt and comment/report grants; it must not receive blanket privileges or the ability to self-grant administration.

## Effect of migration 0006 on existing accounts

Every existing user starts with `email_verified_at=NULL`, `is_verified=false` and `is_admin=false`. Passwords, requests, connections, comments and chat history are preserved. A stable session secret can preserve existing signed-in sessions, but current database authority denies member/chat/admin operations until ownership is verified; own account/settings, verification and logout remain available. This is an intentional access reset, not an automatic sign-out or content deletion.

No existing account is automatically an administrator. An administrator needs both verified mailbox ownership and an explicitly approved, audited `is_admin` grant to the named account. Setting the administrator flag alone does not bypass ownership. Current student roles (`mentor`, `mentee`, `both`) and previous suffix-based verification are not administrator evidence.

The exact upgrade is an approved 0001–0005 ledger to 0006. Stop old writers first: the previous registration implementation writes `is_verified=true` without `email_verified_at` and is incompatible with the new constraint. Back up and rehearse restore, obtain explicit approval for the ownership reset, then use the separately reviewed remote procedure during maintenance. Runtime restarts never apply migrations. The local rehearsal helper's new grants are SELECT/INSERT/DELETE on the verification token/attempt tables, USAGE on the attempt ID sequence, and UPDATE on request comments/reports; review those additions against the existing restricted role rather than granting blanket privileges.

## Required deployment configuration

These are prerequisites to a later authorized deployment. None has been applied externally by this task.

| Setting | Required value or handling |
| --- | --- |
| `NODE_ENV` | `production`; one gateway and one Python worker per single service instance. |
| `PORT` | Render-provided public gateway port; image default 10000. Python remains internal on loopback 8181. |
| `GATEWAY_PUBLIC_ORIGIN` | Exact canonical trusted HTTPS origin for HTTP/WS authorization. |
| `APP_ORIGIN` | The same trusted HTTPS origin as `GATEWAY_PUBLIC_ORIGIN` for ownership links; no path, credentials, query or fragment. |
| `DATABASE_URL`, `READINESS_DATABASE_URL` | The explicitly approved target with schema 0006, reviewed restricted credentials/grants and required TLS. Never point rehearsal tooling at an existing remote database. |
| `SESSION_SECRET` | Stable protected value, at least 32 characters in production. Preserve the existing value for session continuity; intentional rotation invalidates existing signed cookies. |
| `RELEASE_SHA` / `RENDER_GIT_COMMIT` | Build-time source commit identifier for the reviewed release and embedded `release.json`; not a substitute for schema validation. |
| `EMAIL_DELIVERY_MODE` | Defaults to `disabled`. `resend-test` enables the reviewed one-recipient HTTPS adapter only after separate approval. `development-file` is local only and refused in production. |
| `EMAIL_TEST_ALLOWLIST_ENABLED` | Defaults off; only the exact string `true` permits test delivery to the exact configured recipient; it does not restrict signup. Keep `false` while staging credentials. |
| `EMAIL_TEST_RECIPIENT` | One privately approved, bare ASCII mailbox matching the Resend account email. Missing/invalid values fail closed. Case normalizes; dots and plus aliases remain distinct. Never commit the actual address. |
| `RESEND_API_KEY` | A new sending-only key, entered by the user directly in the existing service's protected environment. No client/public-prefixed variable, key in chat, source, logs or command arguments. |

The sender is fixed to `Mentor-Connect <onboarding@resend.dev>` and only the Resend account email can receive. There is no sender or provider URL override. Valid email addresses from any domain are eligible to register, but this test adapter cannot deliver to any other inbox. Thus the one-inbox rehearsal does not establish two-user real-mail acceptance. A broader verified sender and separately approved recipient policy are required for that future step.

Credential staging is user-operated: in the existing Render service, open Environment → Edit → Add variable, then choose **Save only**, which stores settings without triggering a deploy. Keep `EMAIL_DELIVERY_MODE=disabled` and `EMAIL_TEST_ALLOWLIST_ENABLED=false` until the reviewed activation step. The old deployed code ignores these new mail variables; storing them does not add ownership endpoints or make schema 0006 compatible. Do not change existing database URLs, session secret, branch, deployment or plan as part of staging. See [Render save behavior](https://render.com/docs/configure-environment-variables).

Production sessions use Secure, HttpOnly and SameSite=Lax cookies. After the coordinated rollout, verify ownership, administrator access, student matching/chat and unauthorized access using the actual HTTPS origin. Local checks do not replace this acceptance step. The [initial container record](superpowers/reviews/2026-10-17-account-trust-container.md) and [subsequent diagnosis](superpowers/reviews/2026-10-17-socket-responsiveness.md) retain the historical ARM64 timeout, the fixed socket event-loop defect, passing host/ARM64 and scoped AMD64 checks, and the failed/qualified combined emulated AMD64 recovery result. The [native AMD64 comparison](superpowers/reviews/2026-10-17-native-amd64-and-mail.md) passed both resource conditions on 985c86b7; later revisions require their own CI evidence. No request timeout or comment/DM assertion was increased to turn either result green. Actual Render and real-mail acceptance remain pending.

## Ownership verification and administration

- Registration creates an unverified, non-admin account. Any syntactically valid email address is eligible, regardless of domain; registration never proves ownership. The owner explicitly requests delivery at `/verify-email`, opens the newest link and explicitly confirms it while signed in to the same account. Links expire after 30 minutes and work once. Application resend limits are 60 seconds between attempts and five per hour per account.
- Failed or disabled delivery is an error. Definite provider acceptance returns “Verification email accepted for delivery”; it does not establish inbox receipt. An uncertain send/confirmation is not retried automatically; refresh session state or request a new link deliberately. Provider failure preserves the previous token and consumes the persisted attempt; a commit failure after acceptance never returns success.
- The UI removes the link fragment before rendering. Secrets stay only in document memory and are never stored in return destinations, browser storage, query/mutation caches or ordinary logs. A logged-out recipient is told to sign in and request a fresh link. Do not put real verification links into support tickets, screenshots, traces, analytics or incident logs.
- Administrator privilege is separate from mentor/mentee/both. Verify ownership through the approved proof flow first. An authorized operator then grants `is_admin` to one explicitly selected account under the reviewed remote procedure, with an audit record identifying operator, target account, approval and time. Never infer administrators from student role, email suffix, client input or historical data. This branch performs no administrator grant.
- Revocation takes effect on the next authoritative HTTP or socket authorization check. Verify anonymous, unverified, mentor, mentee, both and administrator paths after rollout. Normal verified student room/DM chat remains supported; membership and bilateral blocks still apply.

## Disposable local rehearsal

Use only temporary local databases and test identities. The existing upgrade rehearsal requires `ACCOUNT_TRUST_DATABASE_URL`, exact `ACCOUNT_TRUST_TARGET` JSON (`host`, `port`, `database`, `appRole`), 40-hex `ACCOUNT_TRUST_APP_SHA`, an approval identifier, 64-hex backup digest and a new absolute audit path. Run `node ops/upgrade-account-trust.mjs --apply --acknowledge-email-ownership-reset` only with a disposable `account_trust_upgrade_*` loopback target. Review its protected audit file afterward. It neither selects nor grants an administrator.

The real browser harness in `tests/support/live-deployment.mjs` creates a disposable database and local TLS origin. Only its ownership phase uses `NODE_ENV=test`, `EMAIL_DELIVERY_MODE=development-file`, a protected temporary outbox and `APP_ORIGIN` equal to that local TLS origin. It checks 0700/0600 permissions and reads the local test message without printing the URL/token. It then stops the stack, disables delivery and restarts with `NODE_ENV=production` for the existing consent/chat/restart journey. Container mode retains production behavior and excludes that development-file phase. Production development-file refusal remains enforced independently by Python tests.

Run the complete local pipeline with Node 24 and PostgreSQL 16 on PATH, `PYTHON_BIN` and `CLASSROOM_TEST_PYTHON` pointing at this worktree's `.venv/bin/python`, then `sh scripts/verify-release.sh`. The native-container CI runs the same production browser journey on a standard free public-repository Linux AMD64 runner at 512 MiB/no extra swap: 0.1 CPU is constrained acceptance, while 1 CPU is a separate diagnostic control. Each matrix job builds and checks the exact PR head SHA; it uses only a disposable loopback database and no external service secrets. Linux test containers share the runner network to reach loopback PostgreSQL; Docker Desktop keeps its existing bridge mapping. This test-only choice does not change the deployed network architecture. Record actual CI outcomes before claiming native acceptance.

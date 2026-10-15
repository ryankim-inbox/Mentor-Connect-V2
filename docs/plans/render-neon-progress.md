# Approved Render/Neon implementation

Base: 448e39ff. Branch: codex/render-neon-deployment. The user-approved specification is the delegation in this task.

Scope: local implementation and disposable local tests only. No remote push, real deployment, persistent credentials, existing database changes, or data copies.

1. Docker: Node 24 gateway serves SPA/API/WS; one Python 3.12 worker on loopback; locked dependencies, release metadata, bounded readiness, process supervision.
2. Chat: REST commit then WS broadcast; browser receive/reconnect/history resync/dedup; permissions retained; no application text heartbeat or automatic retry of uncertain sends.
3. Verification: regression suites and HTTPS-only two-account live test runner; deployment runbook with separate empty-DB bootstrap; final review.

Pre-flight: static handler must preserve API routing and security; REST and WS share a single Python process registry; readiness requires migration metadata from build.

Ruling: native managed worktrees are unavailable in this delegated environment; created an approved local git worktree in /tmp instead. Cost: manually managed checkout.

Status: local implementation and verification complete. Dependencies use frozen pnpm and uv locks. Original checkout unchanged. No remote write or real deployment has occurred.

Verification: final Python 361/361 (84.34 seconds); gateway 125/125; frontend unit 7/7; typecheck and release build passed; Playwright fixture suite 68/68. Migration, database/bootstrap, API contract, boundary and smoke-runner checks passed. The real HTTPS browser/DB harness passes two-session room/DM messaging, reconnect dedup, permission guards, reload/login and Python+gateway restart persistence. Docker ARM64 and AMD64 builds passed. ARM64 runtime under a 512 MiB / 0.1 CPU cgroup passed the same browser checks, with peak memory of 197.1 MiB before restart and 112.2 MiB after restart. This small synthetic workload does not establish production capacity. AMD64 runtime and real Render/Neon cold starts remain unverified.

Final hygiene: staged-file secret scan passed for all 513 tracked files; diff whitespace check passed. No lint script is configured. The full `verify:release` umbrella, historical secret scan, real provider tests and real deployment have not been run; the specific local gates listed above were run individually.

Ruling: WS events invalidate canonical REST history rather than append untrusted frames directly. This keeps dedup/read receipts/deletion and fetch races consistent. After follow-up review, history now pages in 50-message chunks back to the oldest displayed message; initial display remains 50 and older history is available on request. Cost: long displayed histories and reconnect gaps use multiple DB/egress requests per resync. The previous latest-50-only recovery limitation is removed.
Ruling: keep bootstrap's unsupported channel_binding rejection. Node pg does not enforce libpq channel_binding=require. Use a separately prepared Node URL with sslmode=verify-full and no channel_binding; preserve required channel binding on the Python DSN. Cost: Node connects with certificate validation without mandatory channel binding.

Final independent review: one Important issue (revoked district socket receiving full message body). Added a failing integration reproduction, then reauthorized all broadcast recipients against current DB permissions; targeted regression 52/52 passed.
Related regression: an already-open room socket also retained send permission after its user moved districts. Reproduced a persisted unauthorized row, then reused canonical REST authorization/persistence for legacy WS sends; chat regression 49/49 passed after the fix.
Final: minor (deferred): CSP intentionally uses self-hosted resources and currently blocks the existing Google Fonts stylesheet; system font fallback remains. Consider self-hosting font in a later UI change.
Final: fixed canonical history ordering — a reversed-ID timestamp test failed before removing the unnecessary client sort, then passed. Ruling: repair this small review finding because retaining server chronology is part of chat correctness; no added behavior or dependencies.

Remote read-only status (2026-10-15): browser login confirmed. Render Eric's workspace is Hobby, no card on file, 0/750 free hours, 0/5 GB outbound, 0/500 build minutes; its one existing service was untouched. Neon is on first-project setup (proposed Mentor_Connect, Free, AWS Ohio), not yet created. Further approval is required for branch push/draft PR, the new project/DB and least-privilege roles, persistent secrets, repository connection grants, and the Free Render service/deployment. Real HTTPS two-account verification remains blocked on those steps.

Follow-up: reproduced room and DM history returning the same newest 50 despite a cursor (two failing real-DB regressions). Added channel-scoped keyset pagination, OpenAPI/generated clients and gateway validation, browser recovery to the previous history anchor, and an older-history button. Tests cover 121 missed messages, empty-history recovery, timestamp/ID ordering, dedup and deletion. Real local HTTPS browsers passed 51-message offline gaps in both room and DM, older-history retrieval after reload/login, and restart persistence. The complete `verify:release` gate is pending below; it installs locked local dependencies, regenerates checked-in API artifacts, runs disposable DB/test servers and Playwright, and does not deploy or contact an existing DB.

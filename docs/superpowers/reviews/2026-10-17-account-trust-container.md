# Account trust — local container follow-up

The local checks are complete, with a qualified result: both images built; the instrumented ARM64 full journey passed; AMD64 under ARM emulation failed its post-restart UI assertion. An earlier ARM64 REST send also returned 504 and its cause remains unresolved. These results do not approve deployment or establish reliability at the tested CPU limit.

Date: 2026-10-17 UTC. Branch: `codex/account-trust-admin`. Runtime source and embedded release SHA: `bea93d300d7c7a6721a15e9e4f95a9e50dea6704` (documentation successor to implementation `b3344a836e99618981c4430c85f5b3996e15a964`). The follow-up changes only the local test launcher and documentation; the product images, request timeouts, assertions and mutation retry behavior are unchanged.

No remote database, credentials/settings, mail/provider, paid service, deployment, push or PR change was made. Temporary local PostgreSQL databases contained synthetic fixtures only.

## Builds and resource bounds

Docker Desktop 4.81.0 / Engine 29.6.1 ran on an ARM64 host. Both builds exited 0:

```sh
docker build --platform=linux/arm64 --build-arg RELEASE_SHA=bea93d300d7c7a6721a15e9e4f95a9e50dea6704 -t mentor-connect:account-trust-bea93d30-arm64 .
docker build --platform=linux/amd64 --build-arg RELEASE_SHA=bea93d300d7c7a6721a15e9e4f95a9e50dea6704 -t mentor-connect:account-trust-bea93d30-amd64 .
```

| Image | Image ID |
| --- | --- |
| Linux ARM64 | `sha256:df488ad455317dbcec1b29126d470a84f5df5f1eddcf1a38bc19b780e6ad7ff7` |
| Linux AMD64 | `sha256:b38bd40f874a144bf48b77ffe7bb7e51d56f23583af151fb2a21a770a51970d0` |

Both images identify non-root user `app`, entrypoint `python ops/run-service.py`, the SHA above and `currentMigrationId=0006_account_trust`. The runtime keeps one Node gateway on the public port and one Python worker on loopback port 8181. It does not migrate or bootstrap on startup.

Each integration container used `--memory=512m --memory-swap=512m --cpus=0.1`, verified through Docker inspect as 536870912 bytes / 536870912 bytes / 100000000 NanoCPUs. This provides no extra swap allowance. No OOM was observed in collected cgroup counters. This is a local constrained check, not a measurement of Render's native CPU allocation or Neon latency.

The integration command was `sh scripts/test-python.sh tests/test_deployment_live.py -q -rP`, with Node 24/PostgreSQL 16 on PATH, this worktree's Python environment and `DEPLOYMENT_TEST_IMAGE` set to the architecture-specific tag. It exercises real Chromium contexts, local TLS, the image's gateway/Python and a disposable PostgreSQL database. Container mode uses production behavior and excludes the development-file email verification phase.

## Results, including failures

| Run | Outcome | Evidence and limitation |
| --- | --- | --- |
| ARM64 initial | FAIL, 135.94s | Report moderation, mentorship, room reconnect recovery and bidirectional DM reached their checks; one REST POST while filling the 51-message DM gap returned 504 instead of 201. Reported maximum memory peak was 200.0 MiB. No automatic retry of the uncertain send or product timeout change followed. Cause is unresolved. |
| ARM64 instrumented, same runtime source | PASS, 154.84s | Full report, mentorship and chat journey passed. Three container lifetimes peaked at 112.1 / 113.7 / 112.3 MiB. 767 HTTP observations, including 573 non-readiness requests; no 504. Successful non-readiness requests had maximum 1511ms and P95 690ms. Seventeen 502 responses occurred during intentional restarts and recovery assertions passed. A later pass does not erase the first failure. |
| AMD64 initial, emulated | FAIL, 34.88s | Original nominal 30-second launch wait ended before gateway startup. No application journey result. Observed 287 of 288 CPU periods were throttled; no OOM. |
| AMD64 after launcher correction, emulated | FAIL, 186.43s | Both starts reached readiness. Real administrator report moderation passed; request/comment/reply/edit/delete, owner acceptance and named DM assertions passed before restart. After restart, the matched-request heading did not appear within the unchanged 5-second UI assertion. The chat smoke sequence after that point was not executed. Two container lifetimes peaked at 168.0 / 168.8 MiB; no observed OOM. |

The AMD64 final run recorded 275 HTTP requests, including 178 non-readiness requests and no 504. Sixteen 502 responses occurred while the backend was restarting. Post-readiness auth/request responses returned 200, with observed request-family durations of 3804, 4880 and 5694ms. These timings support delayed post-restart rendering under constrained emulation; the incomplete UI assertion remains a failure, not proof that the whole journey would eventually pass. The observer recorded only event/family/status/outcome/timing and resource fields, not request bodies, cookies, tokens or environment contents.

A separate network-disabled process-start probe isolated the AMD64 launch issue: at 1 CPU the gateway/Python milestones appeared around 1.96/2.52s; at 0.1 CPU they appeared around 37.68/48.39s. The latter recorded 484 throttled periods out of 486, with no OOM. This justifies correcting the old 30-second **test launch window**. It establishes process timing, not database readiness, and does not explain the earlier ARM64 504.

The only launcher changes are a nominal 90-second container readiness deadline with a 2.5-second abort per probe (the final probe/sleep can add about 2.7s), and a 480-second container-only outer subprocess bound. Host mode retains 180 seconds. Gateway upstream timeout remains 5 seconds; UI assertions, authorization, resource limits and mutation behavior remain unchanged. An independent scoped review found no actionable issue with these two changes. It explicitly required retaining the ARM64 failure and reporting the final AMD64 outcome separately.

The already-passed full host release suite and ARM64 journey were not repeated after the launcher-only adjustment. AMD64 exercised the changed launch path and outer bound. The prior full release evidence remains [422 Python and 104 Playwright tests, plus the other release gates](2026-10-17-account-trust-admin.md); it is not represented as a passing container result. Native Render AMD64 operation, cold Neon behavior, real mail delivery and the public deployment of this revision remain unverified.

## Explicit access matrix

The following matrix is supported by the prior passing host release suite and the referenced assertions, not a claim that every role/path was re-executed in Docker. All four rows assume mailbox ownership is verified. `is_admin` is independent of student role.

| Account | Analytics / operational matching / diagnostic menus | Direct operational URLs | Operational status, analytics and matching APIs |
| --- | --- | --- | --- |
| `mentor`, `is_admin=false` | Hidden | Administrator-access-required screen; no protected fetch | GET and tested mutations return 403 |
| `mentee`, `is_admin=false` | Hidden | Administrator-access-required screen; no protected fetch | GET and tested mutations return 403 |
| `both`, `is_admin=false` | Hidden | Administrator-access-required screen; no protected fetch | GET and tested mutations return 403 |
| Verified `is_admin=true` account | Shown | Operational pages and required data load | Valid tested reads/actions return 200; report moderation persists and audits |

Actual labels are Analytics, Matches, Practice, Scheduling and Reports; there is no separate literal Status menu. Direct routes include `/analytics`, `/recommendations`, `/practice-lab`, `/scheduling`, `/admin/reports`, `/dashboard/practice-lab` and `/dashboard?tab=practice-lab`. The SPA shell can return HTTP 200 before the UI denies access; this is not a claim that the direct page URL returns HTTP 403.

Protected diagnostic APIs include `/api/analysis/status`, `/api/practice/status`, `/api/scheduling/status` and `/api/python-reports/status`, alongside `/api/analytics/*`, matching GET `/api/matches/{id}` and POST `/api/matches`, and administrator reporting. `/livez` and `/readyz` remain public health endpoints. Anonymous operational API requests return 401; current DB authorization rejects unverified accounts and privilege revocation.

Student matching remains available through `/mentors` → `/requests` → application → request-owner acceptance → `/connections` and named DM. This does not grant access to operational `/recommendations` or `/api/matches`. Each mentor/mentee/both role has passing directory/chat access and operational-denial coverage. The actual mentor/mentee two-context consent/DM/restart journey passed in the ARM64 container; the complete acceptance journey was not separately rerun for all three roles. Administrator report editing/persistence passed in both architectures before the AMD64 restart failure.

Evidence: [role menus/direct routes and built-gateway role checks](../../../e2e/account-trust.spec.ts), [real Python/DB role API denials](../../../tests/test_admin_access.py), [administrator browser route/API checks with deterministic backend fixtures](../../../e2e/classroom-flow.spec.ts), [real composed administrator APIs](../../../tests/test_backend_completion.py), [real role socket/membership checks](../../../tests/test_account_trust_role_sockets.py), [two-account consent journey](../../../tests/support/mentorship-journey.mjs), [real administrator moderation journey](../../../tests/support/report-moderation-journey.mjs).

## Migration, deployment prerequisites and PR23

Migration 0006 makes every existing account unverified (`email_verified_at=NULL`, `is_verified=false`) and initially non-admin (`is_admin=false`). It does not delete passwords or community content. Keeping the same session secret can preserve sign-in, but current DB checks deny member/chat/admin access until mailbox ownership is verified. Own account/settings, verification and logout remain accessible. Existing role or suffix-derived verification never creates an administrator: both mailbox proof and a separately authorized, audited administrator grant are required.

Follow the [rollout runbook](../../ACCOUNT_TRUST_RUNBOOK.md) for the exact environment variables, missing production mail adapter, maintenance/backup/restore, restricted grants and separately approved remote migration/admin procedure. No external setting in that runbook has been applied. Do not deploy 0006 while delivery is disabled or old registration writers remain active.

Read-only GitHub metadata confirmed [PR23](https://github.com/ryankim-inbox/Mentor-Connect-V2/pull/23) is **closed and merged**, merged at **2026-10-17T03:30:29Z**, merge commit **`f3972b1046a80b454c6a5e62c84cca9d625c54dd`**. This branch is based on that merge. The account-trust branch itself has not been pushed or merged; the PR's older body text is not its current merge status.

The original checkout and its nine untracked `.DS_Store` entries, the earlier Render/Neon worktree's two modified documentation files, and the clean earlier E2E-fixes worktree were preserved. Local test containers are stopped/removed after each run. Raw diagnostic evidence remains outside the checkout in `/tmp/mentor-account-trust-container.koICQi`; no credential-bearing raw artifacts are committed.

Final follow-up checks: JavaScript/Python launcher syntax passed; staged whitespace check passed; tracked-file credential scan passed across 595 files. This scan does not cover Git history. A separate read-only review of the final evidence report and runbook found no actionable reporting issue. Docker listed no remaining containers from either test image; preservation checks matched the original checkout and both earlier worktrees. No full release-suite rerun was needed for the two launcher-only edits, and no failed container result was relabeled as a pass.

# Native AMD64 comparison and mail preparation

## Native comparison on 985c86b7

[CI run 39012673436](https://github.com/ryankim-inbox/Mentor-Connect-V2/actions/runs/39012673436) passed both matrix jobs on standard Ubuntu 24.04 x86_64 runners. Each job built a native amd64 image and checked its embedded release SHA against the exact PR head `985c86b7ee68b73e28069793fe6f6b062d492d2a`. The image's application behavior matches the previously reviewed socket fix; this commit adds CI/harness preparation and documentation.

| Condition | Complete production browser journey | Duration | Memory peak per container start |
| --- | --- | --- | --- |
| 512 MiB, no extra swap, 0.1 CPU | Pass | 120.89 seconds | 102.6 / 109.5 / 102.5 MiB |
| 512 MiB, no extra swap, 1 CPU control | Pass | 35.36 seconds | 101.3 / 112.3 / 101.4 MiB |

The journey covers report moderation, mentorship/comments/consent/DM, room and DM communication in two isolated browser contexts, restart persistence, reconnect/history recovery and permission/Origin/sender/block negatives. It retains the existing gateway and comment/DM assertion budgets. The container remains production-mode with real mail disabled, so its development-outbox ownership phase is deliberately excluded; host ownership tests cover that local-only phase.

The new harness chooses host networking on native Linux so the disposable PostgreSQL cluster still listens only on loopback; Docker Desktop retains its prior bridge behavior. This is test-only. The runtime still uses one Node gateway and one Python worker, with Python on loopback. New launch-option tests went from 3 failures/1 pass to 4 passes. Independent CI review reported no actionable findings.

The fresh baseline local `sh scripts/verify-release.sh` exited 0: 428 Python tests (163.10 seconds), the separate 45-test rank module check, and 104 Playwright tests (3.1 minutes), alongside the typecheck/build, gateway, schema/migration, contract, generated-code and secret gates. This baseline run's Python collection preceded the mail-boundary patch below. No dedicated lint command is configured; lint is not reported as passed.

This successful native result does not erase [the failed emulated AMD64 run](2026-10-17-socket-responsiveness.md), prove the historical 504 cause, validate a cold remote Neon connection, or establish real Render acceptance. No DB/Render/provider credential is used by this CI and no remote migration/deployment occurs.

## Provider-independent mail boundary

Preparation keeps real delivery disabled. `auth.py` now moves blocking authority and the entire account-lock/delivery/token-commit operation into the existing worker pool. Delivery errors always return a fixed 503 after committing the attempt; empty exception text can no longer produce a false 202 and arbitrary provider exception text is not returned. The locked-account recheck returns 401 if that account disappeared.

Existing ordering is retained: an accepted delivery precedes replacement of the stored token digest and commit; failed delivery preserves the previous token and consumes the cooldown; a failed commit does not produce 202 or another send. No automatic retry, provider SDK, HTTP transport or new runtime setting is added.

The 15 new causal boundary tests first produced 8 failures/7 passes, then 15 passes. The coordinated real local DB/API regression command passed 52 tests in 27.26 seconds:

```sh
sh scripts/test-python.sh tests/test_verification_delivery_boundary.py tests/test_account_trust.py tests/test_gateway_account_trust.py tests/test_account_trust_role_sockets.py tests/test_chat_event_loop.py -q --tb=short
```

Independent mail-boundary review found no actionable issues, reproduced 15 passing focused tests, and independently reproduced the same 8 baseline failures by loading the old module in memory. No source file was reverted for that control.

The baseline native results above precede this mail-boundary change. The final revision must pass its fresh full release and native matrix checks on [PR #24](https://github.com/ryankim-inbox/Mentor-Connect-V2/pull/24); consult the exact head SHA/checks there rather than treating a previous run as coverage of later code.

## Remaining rollout gates

See [provider options](../../MAIL_PROVIDER_OPTIONS.md) and [rollout runbook](../../ACCOUNT_TRUST_RUNBOOK.md). Provider/domain selection, a reviewed provider-specific adapter, explicit credential security approval/secure entry, approved test recipient/content and actual receipt/verification are pending. Migration 0006 must not run before those work. Exact-target backup restoration, maintenance and restricted-grant review are also pending; administrator identity and its later audited grant need separate explicit approval. No main merge, real email, live DB change, administrator grant or Render redeploy was performed.

# Demo administrator preparation plan

Goal: locally prepare the exact ID 991 exception without claiming email ownership.
Architecture: central Python DB authority; gateway and UI consume effective flags.
Tech stack: FastAPI/PostgreSQL, Node gateway, React, pytest, node:test, Playwright.
Spec: ../specs/2026-10-23-demo-admin-design.md

Global constraints: no remote writes, push, deployment or credential handling;
all integration fixtures use disposable loopback PostgreSQL. Preserve student/admin
separation, .edu eligibility, rate limits and truthful ownership state.

## Task 1: Central authority and consumers
- [ ] Add failing policy, HTTP/gateway and UI tests for the pinned exception,
  malformed settings, mismatched identity, reserved/locked users and revocation.
- [ ] Run targeted tests and record the expected denial before implementation.
- [ ] Implement the minimal central policy and remove redundant ownership gates
  only from administrator consumers. Preserve ownership UI and verification flow.
- [ ] Run targeted tests, then full release aggregate with isolated local DB.

Interfaces: `format_user.isAdmin` and `hasMemberAccess` are authoritative server
flags; `isVerified` is independently persisted email ownership proof. No new API
fields. `require_admin` must use the same policy as the exported flag.

## Task 2: Review and approval preparation
- [ ] Update operational documentation with exact activation and revocation scope.
- [ ] Request one fresh read-only review of the full diff; fix important findings.
- [ ] Record actual local evidence, remote checks not executed, and exact pending
  role grant/configuration/deployment approval. Leave the local diff reviewable.

Review focus: authority rechecks and trust boundary; malformed or stale identity;
unverified admin UI query/retry paths; ordinary verified admin compatibility;
student HTTP/WebSocket exclusion; no accidental email proof, permission widening
or runtime role grants. Expected: focused and aggregate tests PASS, no remote action.

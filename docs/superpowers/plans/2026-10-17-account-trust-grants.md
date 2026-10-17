# Account-trust grant and recovery implementation plan

> **For agentic workers:** Use superpowers:executing-plans for this scoped local correction.

**Goal:** Prove the runtime role cannot assign administration while ordinary registration, profile, ownership and student flows work, and rehearse recovery from schema 0005.

**Architecture:** A shared operator-only grant policy is called inside the existing local 0005→0006 transaction. Existing loopback guards remain. Recovery uses version-matched immutable 0005 assets and native PostgreSQL snapshots in disposable local databases; no down migration or remote mutation is implied.

**Spec:** Existing account-trust design/runbook and the user's approved minimum runtime rights; detailed review at `/tmp/mentor-account-trust-grant-plan.md`.

**Constraints:** No secret inspection, new credentials, remote branch, real account creation, automatic verification, main merge or actual administrator grant. The existing six accounts cannot all verify through the one-recipient adapter. Real DB rights are approved but require successful local verification and coordinated migration/recovery gates.

## Tasks

- [x] Reproduce existing table INSERT/UPDATE rights in the local upgrade fixture. Prove missing admin-column denial with a failing test. Add rollback and unsafe owner/membership/PUBLIC privilege cases.
- [x] Implement exact INSERT/UPDATE column grants with fail-closed effective privilege checks inside the transaction. Preserve SELECT/schema/sequence rights and existing new-table grants. Test allowed registration/profile/confirmation and denied admin writes.
- [x] Exercise real HTTP ownership and student flows with the same narrowed policy, using local-only synthetic accounts/outbox. No real mail.
- [x] Rehearse schema-0005 native snapshot restore, failed-0006 transaction rollback, successful 0006 upgrade, and restoration to an empty isolated 0005 target with rows/ledger/catalog and old grants checked. Document the remote remaining gates without weakening existing guards.
- [ ] Run affected DB suite and Python integration cases, obtain one fresh review, and report exact passed/failed/unrun checks.

## Review focus

- Table grants, role membership/SET ROLE, PUBLIC, ownership or grant options must not restore admin assignment.
- Explicit false/DEFAULT admin INSERT and UPDATE must also fail; omitted defaults remain supported.
- SELECT FOR UPDATE and RETURNING must still work under column grants.
- Failed assertions must roll back schema, trust reset, ledger and grants together.
- A 0005 dump and restored data are not a successful live rollback or proof that a one-recipient mail adapter serves all users.

## Progress and rulings

- Baseline: bb8b6df56ffcc3ac4cec127cafd2157b120c6e38, clean isolated worktree.
- Ruling: reuse prior 619/45/110 evidence for unchanged application behavior; run the complete affected DB suite and scoped real-backend regression cases for this operator-only change. No unrelated full UI/native container rerun unless a change or failure warrants it.
- Ruling: keep remote 0006 guarded until mail/recovery prerequisites are satisfied even though the scoped role change is now approved.
- Verification: original broad grants caused five new denial/precondition tests to fail; the shared policy made them pass. Latest complete journey/account-trust/recovery harness: 21 passed, zero failures/skips. Actual HTTP narrow-role registration, profile, confirmation and existing student-flow fixtures: 2 passed.
- Ruling: subsequent user-approved two-account member exceptions and synthetic data expand this branch beyond operator-only changes. Run the entire release suite and CI again, including the new seed harness; the earlier scoped-only verification decision no longer applies.
- Interface: synthetic profiles use a trusted password sentinel consumed by fresh authentication/member/admin checks. Seed identities cannot become either of the two login-test accounts. Both features are separately disabled/unexecuted on the live service.
- Ruling: `/requests` reads a different table from Practice Lab questions. Create 782 question rows and 782 corresponding request posts for the same questions so the requested page and analytics contain the requested dataset; preserve unrelated rows.
- Final: fixed the fresh review's P1 external-schema SECURITY DEFINER bypass. A new `maintenance.elevate()` regression failed before the fix; checking schema USAGE and function EXECUTE in every schema made it pass. The complete operator/recovery harness then passed 22 tests. The regression also asserts unchanged rows, old table grants, schema and ledger.
- Final review scope: the reviewer inspected integrated auth/seed/recovery code and verified frozen assets; final release/CI and actual provider/database operations remain separate gates. Late seed safeguards and real-browser seeded-data coverage are validated by their focused tests and the final full release run.
- Final: seed timestamp precision and partially removed batch history regressions failed before fixes. Preserve the PostgreSQL tracking boundary at millisecond precision and reject unidentifiable matched events with both references null. The latter is deliberately conservative: unrelated orphan history also blocks insertion until reviewed.
- Final: root integration found the new seed CLI could accept unverified/plain remote TLS options. Its connection-policy regression reproduced missing rejection, then passed using the existing isolated connection helper plus explicit remote `verify-full`; all 13 seed tests passed without remote connections.
- Verification: the built SPA/gateway/Python/disposable-DB browser test passed with 988 total users (5 existing plus 983 synthetic), 782 questions and requests; independent SQL/API/UI comparisons cover signup, subject and weekly metrics, bounded paging/filtering, and ordinary-member admin denials.

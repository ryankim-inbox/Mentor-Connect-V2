# Restore ACL semantics implementation plan

> **For agentic workers:** Use superpowers:executing-plans for inline implementation, then an independent code review.

**Goal:** Accept the three confirmed default-ACL representation changes while rejecting any actual privilege or schema drift.

**Architecture:** Preserve original proof and backup files. In the disposable restored PostgreSQL session, build comparison-only copies of relation metadata. PostgreSQL expands NULL ACLs with `acldefault` and decodes complete grantor/grantee/privilege/grant-option tuples. Both the refresh backup verifier and standalone diagnostic use this shared comparison preparation; the remaining proof comparisons stay exact.

**Tech Stack:** Node 24, PostgreSQL 18.6, isolated Python 3.12 launcher.

**Spec:** Delegated v3 result and request: 106 source/restored relations; 3 relacl-only differences; all 3 explicit defaults become NULL; no privilege, identity, owner, order, missing or added differences. Implement minimal semantic comparison, negative tests and independent review; preserve all previous attempts/gates/backups/frozen files; no Neon writes or service resumption.

## Constraints

- Work in the existing isolated checkout on a new local branch.
- Read only safe diagnostic reports; all executable tests use generated fixtures.
- Never exclude the entire ACL field or accept a diagnostic summary as proof.
- Original row/password digests, owner, grantor, grant options, structure, ledger and settings checks remain mandatory.
- New release preparation has a new commit/bundle identity; do not reset an old attempt or manufacture a deployment gate.

## Review focus

- Empty ACL versus NULL default remains different.
- Different owners, grantors, grantees and grant options remain different.
- Missing/extra relations, changed kind, RLS, options, ordering and unexpected fields fail.
- Invalid ACL/unknown role/SQL errors fail closed without data in output.
- Read-only normalization does not mutate either input proof or source database.

## Task: Shared comparison preparation and its callers

**Files:** create `ops/restore-relation-acls.mjs` and a native regression test; modify `ops/demo-refresh-handoff/backup.mjs`, standalone diagnostic and its builder/tests/docs.

**Interface:** `prepareRestoreComparison(client, proof) -> Promise<proofCopy>` retains all proof fields, replaces only comparison-copy `portableSchema.relations[*].relacl` for table/sequence rows with canonical complete ACL tuples, and rejects malformed relation metadata.

- [x] Add failing full-wrapper/default-ACL test and production-verifier negative cases.
- [x] Implement shared read-only PostgreSQL canonicalization; use comparison copies in both verifier paths.
- [x] Run current handoff suite, native synthetic restoration, standalone tests and appropriate repository checks. Report skipped/blocked checks.
- [ ] Obtain independent review; resolve findings, commit reviewed local code and prepare a new code-only frozen checkout without deployment gate or attempt.
- [ ] Report exact release identity, preservation evidence, and minimal remaining user/operator steps. No remote push/deploy/write/resume during this task.

## Validation and review

The full `@workspace/db test` suite passed after the final code change, using only disposable local databases. Standalone diagnostic checks passed (12 Node tests, 14 Python tests including native sandbox checks); typecheck passed. The default-ACL production restore and full-wrapper tests were observed failing before the fix and passing after it.

Independent review found raw `regrole` casting could fold a case-sensitive owner name. A new regression reproduced that false match. Exact `pg_roles.rolname` lookup fixes it and rejects absent owners for NULL, empty and explicit ACLs. Independent re-review approved the change with 18 passing tests and no remaining blocking findings.

The existing historical diagnostic command replay is opt-in; current verification uses generated fixtures only. Local commit, release build and code-only freeze are subsequent operator preparation steps; no deployment gate or attempt is authorized here.

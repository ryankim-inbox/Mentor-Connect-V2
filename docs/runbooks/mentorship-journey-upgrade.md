# Mentorship journey upgrade — pending remote approval

This branch has only been exercised locally. Do not push, change Neon grants/schema, or redeploy Render without the parent task's approval. Public two-account browser validation remains pending Mac unlock and the approved deployment.

## Database changes

Apply the immutable migration ledger in order, using the new test DB's owner connection **only after approval**. Do not rerun empty-database bootstrap or copy any old data. Migration 0004 adds nullable UUID operation keys and two unique constraints to chat tables. Migration 0005 adds `request_applications` and `request_comments`, their indexes and foreign keys. Existing requests, matches, messages, DM conversations and match history are retained. Old matched requests do not need an application record.

The current supported operator CLI, `scripts/migration-entrypoint.mjs`, is **dry-run only**. It cannot apply this upgrade to the populated test database. The tested `runMigrationTransaction` library performs checksum/ledger validation, advisory locking, atomic DDL/ledger writes and rollback; its caller must supply connection targeting, timeouts and operator audit controls. Before remote apply, prepare and review an approved operator launcher for that library with the exact test host/database allowlist, expected existing `0003` ledger, approved release SHA, protected audit output and explicit connection/lock/statement timeouts. Rehearse that launcher on disposable PostgreSQL first. This release prerequisite is still pending; do not remove the dry-run CLI guard or substitute empty-DB bootstrap.

After migrating, the existing application role needs only these additional grants (substitute the verified role identifier, never a credential):

```sql
GRANT SELECT, INSERT, UPDATE ON request_applications TO app_role;
GRANT SELECT, INSERT ON request_comments TO app_role;
GRANT USAGE ON SEQUENCE request_applications_id_seq, request_comments_id_seq TO app_role;
```

Existing chat table privileges cover the new columns. Readiness keeps only its current migration-ledger read; neither runtime identity needs DDL or ledger writes. Test evidence includes a disposable 0003 upgrade, legacy-row equality, and the new HTTP flows under narrow application grants. The test database/container is local and separate from Neon.

Unique constraints take table locks and scan existing chat rows. Schedule a controlled maintenance window and configure the operator launcher's lock/statement deadlines; inspect the test DB's actual size before running. The migration runner must complete before starting the new image, since readiness expects the new ledger version. The old image can become unready as soon as the schema reaches `0005`, so allow for downtime between migration and deployment. Free Render has no predeploy/shell task: execute the approved migration from the trusted local operator environment, then deploy.

## Behavior and compatibility

- REST message sends may include `clientMessageId` (UUID). Same sender+thread+key+body returns the original message; a changed body returns 409. Permission checks still run. Broadcast follows a new committed insert only. The UI keeps an unchanged failed draft's key for explicit retry and never retries automatically. A new/edited draft gets a new key. Legacy callers without a key retain their old behavior; drafts/keys are not persisted across closing or reloading the composer.
- `/requests/{id}/match` now creates a pending application, as does `/applications`. The author accepts or declines; the applicant can cancel and reapply after cancellation. A decline is final for that request. Acceptance creates the actual match event atomically; competing accepts cannot both win. Closing/reopening cancels pending applications; reopening also resets accepted state. Existing conversations remain available.
- Comments support one reply level and 2,000 characters. They render as text and have explicit retry keys. Comments/applications/contacts/activity pages are authenticated, bounded to 50 rows per call, and support `beforeId` pagination.
- UI connections include legacy matches and give named DM entry points. School-email ownership is still not verified: this remains a test service.

## Rollback

Prefer a forward fix. Leave additive columns/tables in place if rolling back runtime code; dropping them loses new discussion/application data. The old backend would re-enable immediate matching via `/match`, so do not roll back to it while accepting traffic unless the parent explicitly approves that behavior or a maintenance shield blocks writes. Runtime readiness checks the exact migration ledger; an old image may reject a newer ledger. A rollback therefore needs its own compatible image/maintenance plan, not a blind image revert.

## Remaining remote steps

Approval is required for push/PR, the new test Neon migrations and grants, and Render redeployment. After those succeed, verify the actual HTTPS release SHA, readiness and deep links, then use two independent browser contexts/accounts for comments, consent, room chat, named DM, refresh/relogin, reconnect recovery and permission failures. Do not report the deployment complete from local fixtures alone.

Proposed order: review and approve the operator launcher and release commit; push the branch/open the approved PR; review/merge only when separately authorized; inspect the exact test DB and establish the approved recovery point; enable the existing maintenance shield for the maintenance window; run dry-run/preflight; apply `0004` then `0005` and the minimum grants; verify ledger/catalog with the application/readiness roles; deploy the reviewed commit to the existing Free service without changing secrets or instance count; verify `/readyz` and `release.json`; lift the shield and run the public two-session checks. Stop on the first failed gate. Keep paid resources, automatic migrations on restart and data copying disabled.

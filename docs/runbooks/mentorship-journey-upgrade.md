# Mentorship journey upgrade — pending remote approval

This branch has only been exercised locally. Do not push, change Neon grants/schema, or redeploy Render without the parent task's approval. Public two-account browser validation remains pending Mac unlock and the approved deployment.

## Database changes

Apply the immutable migration ledger in order with the existing guarded migration command, using the new test DB's owner connection **only after approval**. Do not rerun empty-database bootstrap or copy any old data. Migration 0004 adds nullable UUID operation keys and two unique constraints to chat tables. Migration 0005 adds `request_applications` and `request_comments`, their indexes and foreign keys. Existing requests, matches, messages, DM conversations and match history are retained. Old matched requests do not need an application record.

After migrating, the existing application role needs only these additional grants (substitute the verified role identifier, never a credential):

```sql
GRANT SELECT, INSERT, UPDATE ON request_applications TO app_role;
GRANT SELECT, INSERT ON request_comments TO app_role;
GRANT USAGE ON SEQUENCE request_applications_id_seq, request_comments_id_seq TO app_role;
```

Existing chat table privileges cover the new columns. Readiness keeps only its current migration-ledger read; neither runtime identity needs DDL or ledger writes. Test evidence includes a disposable 0003 upgrade, legacy-row equality, and the new HTTP flows under narrow application grants. The test database/container is local and separate from Neon.

Unique constraints take table locks and scan existing chat rows. Schedule a controlled maintenance window and use the existing migration lock/timeout safeguards; inspect the test DB's actual size before running. The migration runner must complete before starting the new image, since readiness expects the new ledger version. Free Render has no predeploy/shell task: execute the approved migration from the trusted local operator environment, then deploy.

## Behavior and compatibility

- REST message sends may include `clientMessageId` (UUID). Same sender+thread+key+body returns the original message; a changed body returns 409. Permission checks still run. Broadcast follows a new committed insert only. The UI keeps an unchanged failed draft's key for explicit retry and never retries automatically. A new/edited draft gets a new key. Legacy callers without a key retain their old behavior; drafts/keys are not persisted across closing or reloading the composer.
- `/requests/{id}/match` now creates a pending application, as does `/applications`. The author accepts or declines; the applicant can cancel and reapply after cancellation. A decline is final for that request. Acceptance creates the actual match event atomically; competing accepts cannot both win. Closing/reopening cancels pending applications; reopening also resets accepted state. Existing conversations remain available.
- Comments support one reply level and 2,000 characters. They render as text and have explicit retry keys. Comments/applications/contacts/activity pages are authenticated, bounded to 50 rows per call, and support `beforeId` pagination.
- UI connections include legacy matches and give named DM entry points. School-email ownership is still not verified: this remains a test service.

## Rollback

Prefer a forward fix. Leave additive columns/tables in place if rolling back runtime code; dropping them loses new discussion/application data. The old backend would re-enable immediate matching via `/match`, so do not roll back to it while accepting traffic unless the parent explicitly approves that behavior or a maintenance shield blocks writes. Runtime readiness checks the exact migration ledger; an old image may reject a newer ledger. A rollback therefore needs its own compatible image/maintenance plan, not a blind image revert.

## Remaining remote steps

Approval is required for push/PR, the new test Neon migrations and grants, and Render redeployment. After those succeed, verify the actual HTTPS release SHA, readiness and deep links, then use two independent browser contexts/accounts for comments, consent, room chat, named DM, refresh/relogin, reconnect recovery and permission failures. Do not report the deployment complete from local fixtures alone.

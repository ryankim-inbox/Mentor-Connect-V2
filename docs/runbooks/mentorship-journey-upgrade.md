# Mentorship journey upgrade — approved test release

On 2026-10-17 the user approved branch push/PR, migrations and minimum grants on test project `purple-pond-78194407` / `neondb`, and redeployment of the existing Free Render `mentor-connect-test` service. Main merge, paid resources and other services remain excluded. Public two-account verification follows the deployment.

## Database changes

Apply the immutable migration ledger in order, using the new test DB's owner connection **only after approval**. Do not rerun empty-database bootstrap or copy any old data. Migration 0004 adds nullable UUID operation keys and two unique constraints to chat tables. Migration 0005 adds `request_applications` and `request_comments`, their indexes and foreign keys. Existing requests, matches, messages, DM conversations and match history are retained. Old matched requests do not need an application record.

The general `scripts/migration-entrypoint.mjs` remains **dry-run only**. The narrow `ops/upgrade-journey.mjs` launcher wraps the tested transaction runner for this approved `0003` → `0005` release. It checks the exact remote endpoint/project/database/port/application role, or explicitly isolated loopback rehearsal databases; requires verified TLS remotely; checks the baseline and checksums under lock; fingerprints every old table before/after using its original columns; and applies only the additional grants in the same transaction. Deadlines are 10 seconds connect, 5 seconds lock, 60 seconds statement, 30 seconds idle transaction, 65 seconds client query and 120 seconds overall. Do not remove the general dry-run guard or substitute empty-DB bootstrap.

Supply the existing owner connection securely through `JOURNEY_DATABASE_URL` (never command arguments or logs). Other required environment variables are `JOURNEY_TARGET` (JSON with exact `projectId`, `host`, `port`, `database`, `appRole`), `JOURNEY_APP_SHA` (full approved commit), `JOURNEY_APPROVAL_ID`, `JOURNEY_BACKUP_SHA` (the separately verified recovery dump checksum) and `JOURNEY_AUDIT_PATH` (new absolute path). Run `node ops/upgrade-journey.mjs --dry-run` then `--apply`, each with a distinct audit path. Audit files use exclusive creation, mode 0600 and fsync. On failure or an uncertain commit response, inspect the protected audit and actual ledger; do not blindly retry. The launcher refuses an already-upgraded baseline.

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

The scoped approval is recorded above. After deployment, verify the actual HTTPS release SHA, readiness and deep links, then use two independent browser contexts/accounts for comments, consent, room chat, named DM, refresh/relogin, reconnect recovery and permission failures. Do not report the deployment complete from local fixtures alone.

Order: review the operator launcher and release commit; push the branch/open the approved PR without merging main; inspect the exact test DB and establish a recovery dump verified by local restore; quiesce the existing service for maintenance using a reversible Free-supported control; run dry-run/preflight; apply `0004` then `0005` and the minimum grants; verify ledger/catalog with the application/readiness roles; deploy the reviewed commit explicitly from the feature branch without changing secrets or instance count; verify `/readyz` and `release.json`; restore service availability and run the public two-session checks. Render's provider Maintenance Mode is paid and must not be enabled; the app shield or temporary suspension is sufficient. Stop on the first failed gate. Keep paid resources, automatic migrations on restart and unrelated data copying disabled.

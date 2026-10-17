# Account-trust grant and recovery procedure

This is local rehearsal evidence and an operator procedure, not a live migration record. The existing test DB's runtime-role narrowing is approved; new remote branches, credentials, secret transfers, main merge and actual administrator assignment are outside this procedure. Stop existing writers and satisfy the mail/recovery gates before any live 0006 reset.

## Runtime role boundary

`ops/account-trust-grants.mjs` replaces `users` table INSERT/UPDATE with seven registration INSERT columns and six profile/ownership UPDATE columns. It preserves SELECT, schema USAGE and the ID sequence's USAGE. It denies every INSERT/UPDATE on `is_admin`, including false and DEFAULT, and does not assign an administrator. The account-trust upgrade calls it in the same transaction as 0006, token/comment/report grants and ledger recording.

The role must have no privileged attributes, other-role memberships (including NOINHERIT/SET ROLE paths), ownership of users/public/current DB, schema CREATE, users TRIGGER, or reachable SECURITY DEFINER functions in any schema. Reachability requires both schema USAGE and function EXECUTE. PUBLIC users writes are rejected. Effective column privileges must exactly match the allowlists, without grant options. Unexpected authority aborts rather than silently changing another role or PUBLIC. Failures after DDL/grants also roll back schema, trust reset, ledger and grants together.

The CLI `ops/upgrade-account-trust.mjs` still accepts only disposable loopback `account_trust_upgrade_*` databases. This change does not convert it into a remote migration command. A remote operation must pin the reviewed endpoint/database/role/release, record approval and recovery evidence, and reuse the reviewed transaction policy without weakening these safeguards.

## Version-matched snapshots

Backup and restore default to the current schema 0007. Set **`CLASSROOM_SCHEMA_VERSION=0005`** or **`CLASSROOM_SCHEMA_VERSION=0006`** explicitly for either historical schema. The corresponding `database/recovery/0005-{version,catalog}.json` files are exact frozen assets from commit `4fc6f11a2f5a04391b9aeeef9d9bb7d299bd5bc4`; the 0006 files are frozen from `813899f890f722a19c81e08e4c17a50c1c0eff24`. The loader verifies each catalog checksum, counts and canonical hash against its immutable migration prefix. It never changes runtime readiness or migration expectations. Other historical versions are rejected.

Use the existing `ops/backup-classroom.mjs` interface with the exact approved source host/database and securely supplied operator URL. It exports a consistent read-only PostgreSQL snapshot, writes a native custom dump and manifest with 0700 directory/0600 files, and validates catalog/ledger. No URL/password appears in its manifest. Verify the dump's checksum before restoring.

Use `ops/restore-classroom.mjs` with the same explicit version and an **empty, isolated different host/database target**. It checks dump checksum, schema version, restored catalog, all table counts and complete migration ledger. It refuses the source target, a populated database and version mismatch. It is not an in-place destructive rollback tool. `--no-owner --no-acl` is deliberate: separately inventory and restore the reviewed roles/grants before a runtime connects. Passwords are not part of this dump and remain privately controlled.

## Smallest path without an extra external service

1. Back up the approved existing Neon test DB at schema 0005 after stopping writers; keep a protected recovery dump and the precise non-secret role/grant inventory. User/operator supplies existing credentials privately; no agent key extraction.
2. Restore that dump to a disposable **local** PostgreSQL target and verify schema, data, ledger, sequence state and the matching old runtime rights. This needs no new Neon branch or paid service. The automated recovery test uses only synthetic local data; it does not prove a future live dump has been restored.
3. Prove the reviewed mail transport and ownership flow on an isolated new-schema target before resetting the live accounts. With the key stored only in the current Render service and the old deployed schema lacking ownership endpoints, the strict requirement to prove the complete real flow before live 0006 is still a separate ordering gate. Local outbox tests and a successful backup cannot substitute for real inbox proof. An explicitly approved rehearsal target or changed, rollback-backed rollout sequence is required.
4. After all gates, coordinate maintenance, exact-commit deployment, migration/grants and readiness. A new local restore test does not authorize changing the existing public schema or swapping database credentials. Paid Render maintenance mode is excluded.
5. On failure, leave writes stopped and inspect actual schema/ledger. Do not blindly retry an uncertain COMMIT. A previously restored local database is evidence, not the live service's recovery destination. In-place live restoration would overwrite data since the snapshot and needs its own concrete reviewed/approved procedure; the safe empty-target guard remains.

The user subsequently authorized exactly two server-designated test member exceptions. Those exceptions must not set `email_verified_at`, `is_verified` or `is_admin`; they do not prove mail delivery, grant administration, or solve ownership for every legacy account. See the separate test-member-access runbook. Synthetic seed profiles are non-login fixtures and are not these two accounts.

## Rehearsal checks

`sh lib/db/test/journey-upgrade-disposable.sh` covers actual baseline table grants, allowed registration/profile/confirmation SQL (including RETURNING and FOR UPDATE), forbidden administrator writes, unsafe privilege paths, transaction rollback after grant verification, native 0005 snapshot/restore after a successful 0006 transition, preserved data/ledger/catalog, version/source guards and explicit old-role recovery.

`sh scripts/test-python.sh tests/test_journey_schema_upgrade.py tests/test_account_trust_schema_upgrade.py` exercises real HTTP registration, own profile, local test delivery/confirmation, ordinary application/acceptance, comments and chat under the shared narrowed role policy. It uses synthetic local identities, not real email or production credentials.

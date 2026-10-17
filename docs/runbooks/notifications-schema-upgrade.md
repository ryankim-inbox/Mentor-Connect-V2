# Local notifications schema rehearsal

Migration `0007_notifications` moves the table and index previously created during a request into the immutable migration chain. Its table shape matches the merged runtime feature: a BIGSERIAL ID, recipient and optional request foreign keys with cascading deletion, the two notification kinds, message, creation/read timestamps, uniqueness on `(user_id, request_id, kind)`, and the recipient/creation index. Runtime code must not execute DDL.

This helper remains scoped to schema 0007; the current canonical schema is 0008. Migrations 0001–0006 remain unchanged. `upgrade-account-trust.mjs` remains a separately acknowledged 0005→0006 transition and does not apply notification migration 0007 or change its grants.

## Scope and preparation

`ops/upgrade-notifications.mjs` is **local-only**, for disposable or reviewed loopback rehearsal databases named `notifications_upgrade_*`. It validates the exact host, database, port, runtime role, and connected server address. It does not permit a remote database, provision a database, deploy code, or issue user/administrator privileges. Remote schema state and the presence of any runtime-created notifications table remain **unknown**; no remote adoption or upgrade is authorized by this code change.

Use the existing protected operator credentials, never the application role. Before applying, capture a private backup with the explicit `CLASSROOM_SCHEMA_VERSION=0006` option in the classroom backup tooling, record its SHA-256, and rehearse restoring it into a separate empty target. Frozen 0006 assets come from verified commit `813899f8`; frozen 0005 recovery remains available and unchanged. A default current-schema backup now expects 0008 and must not mislabel a 0006 source.

Supply these environment variables through a protected local operator session:

| Variable                     | Value                                                              |
| ---------------------------- | ------------------------------------------------------------------ |
| `NOTIFICATIONS_DATABASE_URL` | Existing loopback operator connection, never committed or logged   |
| `NOTIFICATIONS_TARGET`       | JSON with exact `host`, integer `port`, `database`, and `appRole`  |
| `NOTIFICATIONS_APP_SHA`      | Reviewed 40-character commit SHA                                   |
| `NOTIFICATIONS_BACKUP_SHA`   | SHA-256 of the verified private pre-upgrade backup                 |
| `NOTIFICATIONS_APPROVAL_ID`  | Recorded local rehearsal authorization identifier                  |
| `NOTIFICATIONS_AUDIT_PATH`   | New absolute private audit path, opened exclusively with mode 0600 |

```sh
node ops/upgrade-notifications.mjs --apply
```

The operator requires the exact verified migration ledger through 0006. It rejects already-upgraded or mismatched history. The runtime role must have no privileged attributes, role memberships, schema creation, ownership, callable SECURITY DEFINER escape, or ability to insert/update `users.is_admin`.

## Existing runtime-created objects

If `notifications`, `notifications_id_seq`, or `idx_notifications_user_created` already exists, the helper stops before mutation. `CREATE IF NOT EXISTS` would conceal shape, ownership, permissions, and data differences, so neither the migration nor helper silently adopts an unversioned table—even if it appears similar.

Keep the source unchanged and collect read-only catalog, row-count, dependency, and ACL evidence for a separately reviewed adoption plan. Do not delete the table, clear notifications, mark a migration applied by hand, or rerun a destructive bootstrap. Unknown runtime-created data is a blocker requiring explicit review.

## Transaction and permissions

The advisory-locked transaction creates the table/index, records migration 0007, and grants the selected app role only:

- `SELECT, INSERT` on `notifications`;
- column-level `UPDATE(read_at)`;
- `USAGE` on `notifications_id_seq`.

It verifies those exact rights before commit. It grants no UPDATE on message/recipient/request, DELETE, TRUNCATE, REFERENCES, TRIGGER, sequence mutation, grant options, DDL, or administrator authority. Public/default privileges that would widen access cause rollback. All existing users, ownership evidence, administrator flags, user ACLs, requests, and chat records remain intact.

Any schema, permission, or pre-commit audit failure rolls back the new table, index, sequence, grants, and ledger entry together. If a connection is lost while committing, the result is unconfirmed; inspect the exact ledger and private audit before further action. Raw connection/database errors are not printed by the CLI.

## Verification and recovery

Run the local disposable harness:

```sh
sh lib/db/test/notifications-upgrade-disposable.sh
```

It verifies 0006→0007 preservation, real inserts and read acknowledgements under the restricted runtime role, denial of DDL/message/admin changes, refusal of unversioned objects, unsafe-grant rollback, and injected late-failure rollback. The existing database suite checks the frozen catalog and Drizzle mirror, current-schema bootstrap/backup/restore, and explicit 0005/0006/0007 recovery selection. Backend and browser behavior are checked by the runtime/contract workstream.

For a recovery rehearsal, restore the verified 0006 backup only into a separate empty database, using `CLASSROOM_SCHEMA_VERSION=0006`. The backup tooling omits ACLs intentionally: restore the previously reviewed 0006 runtime grants explicitly. Do not overwrite a live source or remove notification data to simulate rollback. Remote execution needs its own reviewed compatibility, backup, and authorization steps.

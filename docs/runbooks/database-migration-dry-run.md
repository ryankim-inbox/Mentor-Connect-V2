# Database migration dry-run guard

Merges, checkouts, installs, and builds do not make database changes. The
post-merge hook installs locked dependencies and runs TypeScript typechecking
only. It never invokes a migration, a schema push, a secret scan, or any other
lifecycle action beyond that read-only validation.

Until a guarded apply entrypoint is approved, the only supported database
migration entrypoint is the audited root dry-run. It verifies the repository
ledger and checksums, opens an explicitly approved target only for a read-only
transaction, validates the target's applied ledger as an exact immutable
prefix, and plans through the named pending migration. It never executes
migration SQL or changes the database. It writes one JSON line to a
deployment-owned, pre-opened audit sink:

```sh
DATABASE_URL='postgresql://...@staging-db.internal:5432/mentor_connect' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_AUDIT_FD=3 \
MIGRATION_AUDIT_APPEND_ONLY=1 \
node scripts/migration-entrypoint.mjs \
  --env staging \
  --actor release-engineer \
  --migration-id 0002_integrity_constraints_indexes \
  --backup-id backup-20260902 \
  --approval-id change-123 \
  --dry-run \
  3>> /secure/audit/migrations.jsonl
```

The database identity used here must have read-only permissions. The environment
must be `staging` or `production`. Its matching, separately
configured allowlist (`MIGRATION_ALLOWED_HOSTS_STAGING` or
`MIGRATION_ALLOWED_HOSTS_PRODUCTION`) must contain the `DATABASE_URL` hostname;
the other environment's list is never considered. The guard refuses missing or
duplicate arguments, non-PostgreSQL URLs, unmatched hosts, migration IDs absent
from the immutable ledger, histories that are not an exact checksum-matching
prefix, migrations that are not pending in order, and any run without
`--dry-run`.

The trusted deployment launcher must open the approved, pre-existing regular
audit file with append-only semantics, pass the inherited descriptor number as
`MIGRATION_AUDIT_FD`, and set `MIGRATION_AUDIT_APPEND_ONLY=1`. The migration
process never receives or resolves an audit pathname. It validates the inherited
descriptor with `fstat`, rejects missing, invalid, directory, device, pipe, or
other non-regular sinks, and writes only through that descriptor. The runtime
cannot portably verify the descriptor's append flag, so the launcher-owned
append-only guarantee is explicit and required.

Audit-file selection, directory/file permissions, ownership, rotation, and
durability (including flush/sync policy and durable storage) are deployment
responsibilities and are currently environment-specific configuration, not
repository facts. Keep this configuration outside the repository. Do not put
credentials, a database URL, or a backup artifact in an audit entry.

Each successful dry run records the actor, exact migration ID, target
environment, host, port, and database name, approval ID, backup ID, start/end
timestamps, applied and repository ledger tails, target checksum, planned
migration count and checksum, read-only flag, and `dry-run-validated`. A failed
validation after audit setup records the same request/target metadata with
`dry-run-failed` and a fixed non-secret failure code. Neither stdout nor audit
evidence contains `DATABASE_URL` or credentials.

There is no package-script alias for this descriptor-sensitive command because
package managers do not guarantee propagation of descriptors above stderr.
The direct root Node entrypoint above is the single supported path. There is
also no `@workspace/db migration:apply` package or CLI command. The library-only
migration runner is unreachable from package lifecycle and operator commands. A
future approved runner must retain all audit fields and write the real execution
result before it is allowed to apply DDL.

The canonical schema, immutable ordered ledger, read-only status/diff commands,
and library-only advisory-lock runner are documented in
`docs/runbooks/database-schema-and-migrations.md`. Their presence does not
authorize an apply operation: this release entrypoint remains dry-run-only.

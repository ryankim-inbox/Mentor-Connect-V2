# Database migration dry-run guard

Merges, checkouts, installs, and builds do not make database changes. The
post-merge hook installs locked dependencies and runs TypeScript typechecking
only. It never invokes a migration, a schema push, a secret scan, or any other
lifecycle action beyond that read-only validation.

Until the approved migration runner arrives in Slices 09–10, the only supported
database migration entrypoint is a dry-run guard. It validates the requested
target without connecting to or changing a database, then appends one JSON line
to a configuration-owned audit log:

```sh
DATABASE_URL='postgresql://...@staging-db.internal:5432/mentor_connect' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_AUDIT_LOG='/secure/audit/migrations.jsonl' \
pnpm run migration:dry-run -- \
  --env staging \
  --actor release-engineer \
  --migration-id 20260902_add_index \
  --backup-id backup-20260902 \
  --approval-id change-123 \
  --dry-run \
  --audit-log /secure/audit/migrations.jsonl
```

The environment must be `staging` or `production`. Its matching, separately
configured allowlist (`MIGRATION_ALLOWED_HOSTS_STAGING` or
`MIGRATION_ALLOWED_HOSTS_PRODUCTION`) must contain the `DATABASE_URL` hostname;
the other environment's list is never considered. The guard refuses missing or
duplicate arguments, non-PostgreSQL URLs, unmatched hosts, and any run without
`--dry-run`.

`MIGRATION_AUDIT_LOG` is configuration-owned and must exactly match the
`--audit-log` argument. It must be an absolute canonical path below an existing
non-symlink directory and name a pre-existing regular file. The guard opens
that file atomically with the platform no-follow flag, validates the opened file
descriptor, writes through that descriptor, and closes it. Devices such as
`/dev/null`, symbolic links, absent files, and platforms without no-follow
opens are rejected. Keep allowlists and audit-log configuration outside the
repository. Do not put credentials, a database URL, or a backup artifact in an
audit entry.

Each completed dry run records the actor, exact migration ID, target
environment and host, approval ID, backup ID, start/end timestamps, dry-run
flag, and result. A future approved runner must retain these fields and write
the real execution result before it is allowed to apply DDL.

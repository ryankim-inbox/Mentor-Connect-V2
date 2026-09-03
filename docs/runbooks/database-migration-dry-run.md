# Database migration dry-run guard

Merges, checkouts, installs, and builds do not make database changes. The
post-merge hook installs locked dependencies and runs TypeScript typechecking
only. It never invokes a migration, a schema push, a secret scan, or any other
lifecycle action beyond that read-only validation.

Until the approved migration runner arrives in Slices 09–10, the only supported
database migration entrypoint is a dry-run guard. It validates the requested
target without connecting to or changing a database, then appends one JSON line
to the caller-selected audit log:

```sh
DATABASE_URL='postgresql://...@staging-db.internal:5432/mentor_connect' \
MIGRATION_ALLOWED_HOSTS='staging-db.internal' \
pnpm run migration:dry-run -- \
  --env staging \
  --actor release-engineer \
  --migration-id 20260902_add_index \
  --backup-id backup-20260902 \
  --approval-id change-123 \
  --dry-run \
  --audit-log /secure/audit/migrations.jsonl
```

The environment must be `staging` or `production`; `MIGRATION_ALLOWED_HOSTS`
is required and must contain the `DATABASE_URL` hostname. The guard refuses
missing or duplicate arguments, non-PostgreSQL URLs, unmatched hosts, and any
run without `--dry-run`. Keep the allowlist and audit log outside the
repository. Do not put credentials, a database URL, or a backup artifact in an
audit entry.

Each completed dry run records the actor, exact migration ID, target
environment and host, approval ID, backup ID, start/end timestamps, dry-run
flag, and result. A future approved runner must retain these fields and write
the real execution result before it is allowed to apply DDL.

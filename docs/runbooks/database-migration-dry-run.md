# Database migration dry-run guard

Merges, checkouts, installs, and builds do not make database changes. The
post-merge hook installs locked dependencies and runs TypeScript typechecking
only. It never invokes a migration, a schema push, a secret scan, or any other
lifecycle action beyond that read-only validation.

Until a guarded apply entrypoint is approved, the only supported database
migration entrypoint is a dry-run guard. It validates the requested target
without connecting to or changing a database, then writes one JSON line to a
deployment-owned, pre-opened audit sink:

```sh
DATABASE_URL='postgresql://...@staging-db.internal:5432/mentor_connect' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_AUDIT_FD=3 \
MIGRATION_AUDIT_APPEND_ONLY=1 \
pnpm run migration:dry-run -- \
  --env staging \
  --actor release-engineer \
  --migration-id 20260902_add_index \
  --backup-id backup-20260902 \
  --approval-id change-123 \
  --dry-run \
  3>> /secure/audit/migrations.jsonl
```

The environment must be `staging` or `production`. Its matching, separately
configured allowlist (`MIGRATION_ALLOWED_HOSTS_STAGING` or
`MIGRATION_ALLOWED_HOSTS_PRODUCTION`) must contain the `DATABASE_URL` hostname;
the other environment's list is never considered. The guard refuses missing or
duplicate arguments, non-PostgreSQL URLs, unmatched hosts, and any run without
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

Each completed dry run records the actor, exact migration ID, target
environment and host, approval ID, backup ID, start/end timestamps, dry-run
flag, and result. A future approved runner must retain these fields and write
the real execution result before it is allowed to apply DDL.

The canonical schema, immutable ordered ledger, read-only status/diff commands,
and library-only advisory-lock runner are documented in
`docs/runbooks/database-schema-and-migrations.md`. Their presence does not
authorize an apply operation: this release entrypoint remains dry-run-only.

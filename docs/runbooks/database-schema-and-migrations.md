# Canonical database schema and migration ledger

## Authority and current evidence

The ordered, checksum-pinned migration files listed in
`database/migrations/ledger.json` are the deployment schema source of truth.
`database/schema/canonical.sql` is the current empty-database materialization:
the exact byte concatenation of every migration in ledger order. It is not an
independently editable baseline. `database/schema/version.json` pins the
materialization checksum and identifies the current ledger tail by both
`schemaVersion` and `currentMigrationId`.

Version `0002` is the current ledger tail: 13 tables, 86 columns, 46
constraints, and 39 indexes. Its normalized catalog was reproduced in a
disposable loopback PostgreSQL cluster and is stored in
`database/schema/local-catalog.json`. See
`docs/runbooks/database-integrity-preflight.md` for preflight, quarantine,
constraint, plan, deletion-policy, and recovery details.

The Drizzle definitions in `lib/db/src/schema/` represent the current
materialized schema for application queries and types. They are not an
independent schema authority. Tests compare every table's primary, unique,
foreign-key, and check constraints plus non-constraint indexes with the frozen
catalog. Do not use `drizzle-kit push`, `db push`, or a package lifecycle hook
to reconcile a database. Those entrypoints are deliberately absent.

The staging and production schemas, preflight results, query plans, p95, and
index lock times are **[UNKNOWN]**. No remote introspection was performed for
this slice. The local catalog, canonical SQL, and mock seed are not evidence of
remote state. Production application is forbidden before the Slice 11 recovery
rehearsal.

## Read-only checks

Validate repository checksums, counts, schema version, migration ordering, the
current ledger tail, and exact deterministic materialization without connecting
to a database:

```sh
pnpm --filter db schema:check
```

Inspect a configured target's ledger. This command starts a PostgreSQL
`READ ONLY` transaction and never creates the ledger table:

```sh
DATABASE_URL='postgresql://user@localhost:5432/mentor_connect_mock' \
  pnpm --filter db migration:status
```

Compare a configured target with the frozen local catalog. The explicit flag
is mandatory; the command begins a `READ ONLY` transaction before reading
tables, columns, types, defaults, constraints, or indexes:

```sh
DATABASE_URL='postgresql://user@localhost:5432/mentor_connect_mock' \
  pnpm --filter db schema:diff -- --read-only
```

Neither database command prints `DATABASE_URL`. A zero diff establishes only
that the inspected target matches version `0002`; it does not establish data
consistency.

## Ordered migration and runtime ledger contract

`database/migrations/ledger.json` is append-only and ordered by the numeric
prefix of each migration ID. Migration IDs and paths must be unique, numeric
prefixes must strictly increase, and each SHA-256 must match the referenced
file. `0001_canonical_baseline.sql` is immutable history. The current canonical
file is mechanically derived from that history and is the exact bytes of
`0001` followed by the exact bytes of `0002`.

The library-only `runMigrationTransaction({ client, ledger, appSha })` in
`lib/db/tools/migration-runner.mjs` defines the contract consumed by the next
release slice. It:

1. rejects transaction-boundary commands before issuing any client query; the
   SQL-aware scanner recognizes LF, CR, and CRLF line-comment endings and
   ignores comments, quoted strings/identifiers, and dollar-quoted bodies
   (including non-ASCII identifier tags) but rejects malformed or unterminated
   lexical regions and executable `BEGIN`, `START TRANSACTION`,
   `COMMIT`/`END`, `ROLLBACK`/`ABORT`, savepoint boundaries, and prepared
   transaction boundaries;
2. begins one transaction and sets transaction-local `search_path` to
   `public, pg_catalog` plus standard-conforming string parsing;
3. obtains `pg_advisory_xact_lock(774301992604150)` before schema or ledger
   writes;
4. creates the operational `mentor_connect_schema_migrations` ledger if
   absent;
5. rejects applied history that is not an exact prefix of the repository
   ledger and rejects any checksum mismatch;
6. applies pending SQL and records `ordinal`, `migration_id`, `checksum`,
   `applied_at`, and `app_sha`; and
7. commits everything together or rolls back everything on any failure.

There is intentionally no mutating CLI or package script for this function.
The Slice 08 `scripts/migration-entrypoint.mjs` remains dry-run-only and still
requires its environment-specific host allowlist, actor, migration ID, backup
ID, approval ID, and trusted-launcher audit descriptor. A future apply
entrypoint must retain all of those controls and write its outcome to that
launcher-owned sink before it may call the runner.

The operational ledger table is excluded from application-schema diffs. An
existing database that predates the ledger may therefore show schema diff `0`
while status reports the baseline as pending. Do not run the baseline over
such a database. Baseline adoption requires a separately approved procedure
that first proves a zero read-only diff, then records the exact baseline
checksum and application SHA under the guarded migration entrypoint.

## Empty-database reproduction

The automated database test creates a new temporary PostgreSQL cluster under
`mktemp`, binds only to `127.0.0.1`, applies the baseline, verifies the complete
catalog, and destroys that cluster:

```sh
pnpm --filter db test
```

Do not point reproduction tests at a shared local database, staging, or
production. The fixture test is the only approved write target in this slice.

## Legacy inventory (read-only inputs)

The following tracked files were inventoried but not changed. They remain
teaching/legacy inputs and must never be treated as deployment truth:

| Legacy input                                         | SHA-256                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `Python/create_tables.sql`                           | `f70d8f44e59f36abe452f25fb00ba124a388c0e5a56d99959527c8a69cbdaae9` |
| `Python/migrations/001_practice_additive.sql`        | `ad0541551899ad67eb786be8ad556c0279d7d1dea454365c634e0f027e9c877c` |
| `Python/migrations/002_requests_preferred_times.sql` | `05492283bcced9a6b3df90cf066d650b94521e2ec4c39de6aa84a0fff8108bb9` |
| `Python/migrations/003_chat_learning_schema.sql`     | `c119572f161cd0cc1836e454bf8eef3ea47d48da604f051ab29fc4dbe0929822` |

`database/mentor_connect_mock_1000.sql` remains a deterministic local data
seed and legacy compatibility fixture. Its schema section is not authoritative.

## Forward-only corrections and recovery

Never edit or delete a released migration. Correct schema mistakes by adding a
new, higher-numbered forward migration, its checksum, verification query, and
rollback or roll-forward strategy. Then regenerate `canonical.sql` by exact
ordered concatenation, refresh the current catalog from a disposable
empty-database reproduction, and update `version.json` to the new ledger tail,
materialization/catalog checksums, and counts. `schema:check` rejects an
independently edited or incomplete materialization. A failed runner transaction
rolls back schema and ledger writes. After a committed migration, use a reviewed
forward migration for recovery; do not rewrite ledger history.

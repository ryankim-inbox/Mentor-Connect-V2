# Classroom database bootstrap and seed

Use these tools only for a newly provisioned, empty classroom database. They
do not migrate an existing deployment, adopt an untracked schema, reset data,
or run during startup or post-merge hooks.

## Required operator inputs

Set these values in the operator shell or secret store. Do not save a real
database URL or the generated credential file in Git.

```sh
export CLASSROOM_DATABASE_URL='postgresql://classroom-db.example.com/classroom?sslmode=verify-full'
export CLASSROOM_ALLOWED_HOST='classroom-db.example.com'
export CLASSROOM_DATABASE_NAME='classroom'
export CLASSROOM_APP_SHA='<7-to-64-character-lowercase-hex-release-sha>'
export CLASSROOM_ORIGIN='https://classroom.example.com'
export CLASSROOM_CREDENTIAL_FILE='/absolute/private/path/classroom-accounts.json'
```

The database URL authority must name exactly the allowed host and database.
The scripts reject query parameters that can override host, database, user, or
other connection behavior before connecting. Supported `pg` TLS parameters
(`ssl`, `sslmode`, `sslcert`, `sslkey`, `sslrootcert`, and
`uselibpqcompat`) are retained.

## One-time bootstrap

Run the schema bootstrap once against the empty database:

```sh
node ops/bootstrap-classroom.mjs
```

The command verifies the checked-in schema assets, takes the migration advisory
lock, verifies that `public` has no tables, and applies migrations 0001 and 0002. A second invocation fails because the database is no longer empty. It
does not drop or reset any object.

## One-time seed

Start the deployed Python API at `CLASSROOM_ORIGIN`, configured to use the same
`CLASSROOM_DATABASE_URL`, then run:

```sh
node ops/seed-classroom.mjs
```

The seed creates two synthetic districts, Math and Science tags, one global
room, two district rooms, mentor and mentee accounts through the existing
`/api/auth/register` route, the mentor's Math subject through the authenticated
self-profile route, and one Math/Algebra question for the returned mentee ID.
It verifies each returned account in the selected database instead of assuming
IDs or trusting that the API uses the same target.

The credential path is created exclusively with mode `0600` before any seed
mutation. Its JSON contract is:

```json
{
  "accounts": {
    "mentor": { "id": 0, "email": "", "password": "" },
    "mentee": { "id": 0, "email": "", "password": "" }
  },
  "fixtures": {
    "questionId": 0,
    "globalRoomId": 0,
    "districtIds": []
  }
}
```

Store this file privately for classroom operators. Do not email it or stage it.
The generated emails are synthetic fixtures and must not be used to send real
mail.

If seeding fails after the base fixtures or an account was created, preserve
the database and reserved credential file for inspection. The tool refuses a
repeat seed and does not attempt to delete partial state. Provision another
empty database for a clean retry, or reconcile the failed target through an
explicitly reviewed operator procedure.

## Read-only verification

Use the exact classroom URL and allowlist for every check:

```sh
pnpm --dir lib/db schema:check
DATABASE_URL="$CLASSROOM_DATABASE_URL" \
  pnpm --dir lib/db schema:diff -- --read-only
DATABASE_URL="$CLASSROOM_DATABASE_URL" \
MIGRATION_ALLOWED_HOSTS_STAGING="$CLASSROOM_ALLOWED_HOST" \
  pnpm --dir lib/db constraints:verify -- --env staging
```

Confirm through the application that login succeeds for both generated
accounts, `/api/chat/rooms` includes the recorded global room, and matching for
the recorded question either returns candidates or the existing student
failure envelope. Do not describe a student-code failure envelope as a
deployment connection failure.

## Classroom snapshots and restore rehearsal

Install native PostgreSQL 16 `pg_dump` and `pg_restore` on the operator host.
Keep the same validated `CLASSROOM_DATABASE_URL`, `CLASSROOM_ALLOWED_HOST`, and
`CLASSROOM_DATABASE_NAME` from bootstrap. Take a snapshot before each class and
after class when useful:

```sh
export BACKUP_OUTPUT_DIR='/absolute/private/path/classroom-backups'
node ops/backup-classroom.mjs
```

The JSON output identifies a new custom-format `.dump` and its adjacent
`.dump.json` manifest, including SHA-256, schema version, capture time, source
host/database, all 13 application table counts, and the applied-ledger checksum.
The output directory is restricted to `0700`; dump and manifest files use `0600`.
The exporter keeps one repeatable-read snapshot open while capturing counts and
ledger and while native `pg_dump --snapshot` runs. Application writes can
continue; pause schema changes during the operation. Catalog inspection uses a
separate connection so its own transaction cannot close the exported snapshot.

Upload **both files together** to access-controlled, encrypted provider storage.
Keep the latest seven verified snapshots there. Check upload integrity before
expiring an older snapshot. The deployment filesystem is temporary working
space and must never be the only durable backup. These upload, encryption and
retention steps are operator actions; the scripts do not claim to configure or
verify a provider. Keep the separate account credential file in the approved
secret store; restoring the database does not regenerate it.

Provision a fresh, empty target database and keep it isolated from application
writers until verification completes. Its host/database combination must differ
from the recorded source; changing only the port is insufficient. Set the two
restore inputs and pass the downloaded dump path:

```sh
export RESTORE_DATABASE_URL='postgresql://restore-db.example.com/classroom_rehearsal?sslmode=verify-full'
export RESTORE_EXPECTED_DATABASE='classroom_rehearsal'
node ops/restore-classroom.mjs '/absolute/private/path/classroom-backups/classroom-example.dump'
```

Keep the adjacent manifest beside that dump. The wrapper checks the explicit
expected database, rejects URL target overrides, verifies the dump checksum,
and refuses any target containing user schemas, relations, functions, types or
non-default extensions before spawning `pg_restore`. Database names must match
`[A-Za-z_][A-Za-z0-9_-]*` because native `--dbname` also accepts connection strings.
Connection credentials travel through child environment fields, never command
arguments. Inherited `PG*` target/options are removed. Explicit URL TLS modes
and certificate paths are retained; certificate options without a mode use
`verify-full`. Ambiguous `ssl`/`sslmode` combinations are rejected. Use explicit
provider-required `sslmode` and CA settings. No raw native stderr is logged.

Restore uses `--exit-on-error --single-transaction --no-owner --no-acl`. It never
uses `--clean` or drops/resets a target. See the native
[PostgreSQL 16 restore contract](https://www.postgresql.org/docs/16/app-pgrestore.html).
After restore, the existing frozen-catalog comparison verifies tables, columns,
FK/unique/check constraints and indexes. The wrapper also verifies all table
counts, schema version and the full applied-ledger checksum. Success reports
`verified: true` and `elapsedMs`. If verification fails, preserve that target
for inspection and provision a different empty database for a retry.

Aim to complete restore within 30 minutes. Record each rehearsal in the
operator's change record with the following fields; do not substitute local
fixture evidence for a provider rehearsal:

| Field | Required evidence |
| --- | --- |
| Snapshot capture | Manifest `capturedAt`, schema version, SHA-256 |
| Backup reference | Encrypted provider object/version reference for dump and manifest |
| Target | Non-secret host/database, isolated from writers |
| Validation | `verified`, counts, ledger checksum, catalog match |
| Restore duration | Observed `elapsedMs`, compared with 1,800,000 ms target |
| Reviewer | Named operator/reviewer and rehearsal time |
| Retention | Latest seven verified provider references; expiration confirmation |

For a disposable local check, run `sh lib/db/test/classroom-restore-disposable.sh`.
It creates and removes its own local cluster and tests checksum/target refusal,
concurrent-write snapshot consistency and successful native restore. This check
is also part of the normal `pnpm --dir lib/db test` entrypoint.

Local rehearsal evidence on 2026-09-10: the coordinator's independently seeded
PostgreSQL 16 database restored with `verified: true` in **66 ms**, with schema
`0002`, all 13 counts and ledger checksum matching. Reviewer: Codex execution
coordinator. The capture time was `2026-09-10T03:32:18.308Z`; the dump SHA-256
reference was `55b22502ad43954ec7e8ddb47fa66bda574c9158b0a432108d2e9223c2fa366b`.
The sanitized execution record is
`.superpowers/sdd/2026-09-09-full-learning-production/integration-restore.json`.
This proves a local rehearsal only. Encrypted provider object references,
seven-snapshot retention and an operational reviewer remain unverified.

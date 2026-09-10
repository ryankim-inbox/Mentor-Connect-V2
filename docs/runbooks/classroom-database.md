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

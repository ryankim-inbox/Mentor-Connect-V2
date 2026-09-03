# Database integrity preflight and version 0002

## Release boundary

Migration `0002_integrity_constraints_indexes` is an append-only ledger entry.
Production application is forbidden until the Slice 11 recovery rehearsal is
approved. No command in `@workspace/db` can apply SQL: `migration:apply`
accepts only `--dry-run`, validates the environment-to-host binding, verifies
the repository ledger, and does not open a database connection. The guarded
root launcher remains the only migration gate and still requires actor,
migration, backup, approval, and trusted append-only audit-descriptor metadata.

Staging and production preflight, plan, p95, and index lock-time evidence are
all **[UNKNOWN]**. Local disposable-cluster results are not evidence for either
environment.

## Environment binding

Every integrity command requires exactly one `--env` value: `local`,
`staging`, or `production`. `local` accepts only `localhost`, `127.0.0.1`, or
`::1`. Remote inspection requires an exact lower-cased hostname in the
environment-specific allowlist:

```sh
export DATABASE_URL='postgresql://migration-reader@staging-db.internal/mentor_connect'
export MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal'
```

The tools never print `DATABASE_URL`. The three database inspection commands
begin `TRANSACTION READ ONLY`, set a transaction-local `public, pg_catalog`
search path, confirm `transaction_read_only=on`, and commit or roll back before
disconnecting.

## Required staging sequence

Run only under the approved staging read-only identity. These commands are
documented for an authorized operator; they were not run by Slice 10:

```sh
pnpm --filter db migration:preflight -- --env staging
pnpm --filter db migration:apply -- --env staging --dry-run
pnpm --filter db constraints:verify -- --env staging
pnpm --filter db explain:verify -- --env staging
```

`migration:preflight` must report `violations 0; quarantine not-required`.
Any nonzero result exits unsuccessfully. It emits deterministic JSON with this
shape:

```json
{
  "readOnly": true,
  "cleanupPerformed": false,
  "violationCount": 1,
  "checks": [
    {
      "id": "self_block",
      "category": "self_relation",
      "violationCount": 1,
      "candidates": [{ "id": 17, "blockerId": 4, "blockedUserId": 4 }]
    }
  ],
  "quarantine": {
    "required": true,
    "candidateCount": 1,
    "candidates": [
      {
        "checkId": "self_block",
        "candidate": { "id": 17, "blockerId": 4, "blockedUserId": 4 }
      }
    ]
  },
  "approvalTaskRequired": true
}
```

Never delete, rewrite, reorder, or canonicalize reported candidates during
preflight. Save the output as release evidence, quarantine the listed row IDs
from the release, and open a separate data-remediation change with explicit
owner and approval. Re-run preflight after that separately reviewed work.

## Invariants and deletion policy

The preflight counts invalid `users.role`, `requests.role`,
`requests.status`, and `chat_rooms.type`; duplicate block, request-tag, and
canonical DM pairs; self blocks and reports; non-canonical DM ordering; and
orphans for every catalog foreign key.

Version 0002 adds `blocks_no_self_check`, `reports_no_self_check`, and
`dm_conversations_canonical_pair_check`. A DM pair must satisfy
`user_a_id < user_b_id`; callers canonicalize a pair as the smaller user ID
first. The baseline unique `(user_a_id, user_b_id)` constraint then prevents a
second room for the same canonical pair. The baseline already enforces unique
block pairs and unique request-tag pairs.

Deletion policies are intentional:

| Relationship                          | Policy              | Reason                                                            |
| ------------------------------------- | ------------------- | ----------------------------------------------------------------- |
| request tag → request                 | `ON DELETE CASCADE` | Join rows have no meaning after request deletion.                 |
| chat message → room/user              | `ON DELETE CASCADE` | Chat child data follows its owning room/account.                  |
| DM conversation/message relationships | `ON DELETE CASCADE` | DM child data follows its owning conversation/account.            |
| question/schedule → user              | `ON DELETE CASCADE` | Practice/availability child data follows the account.             |
| users/requests/chat rooms → district  | `NO ACTION`         | Prevent deletion of referenced district identity.                 |
| request tag → tag                     | `NO ACTION`         | Prevent deletion of a referenced taxonomy value.                  |
| request → author/matched user         | `NO ACTION`         | Prevent silent loss or detachment of request history.             |
| block/report → users                  | `NO ACTION`         | Preserve safety evidence and require explicit retention handling. |

## Index and plan verification

Email uniqueness supplies `users_email_key`; baseline indexes cover district,
request status, and each request-tag join direction. Version 0002 adds
`idx_users_matching_lookup (district_id, role, is_verified, id)` and the
partial `idx_requests_open_matching_lookup (district_id, role, created_at
DESC, id) WHERE status = 'open'`.

`explain:verify` uses PostgreSQL JSON EXPLAIN (without ANALYZE, so it does not
execute application queries) and requires expected indexes for six
representative lookups: email, district, status, request-tag, mentor matching,
and open-request matching. A plan failure blocks migration approval. This is
plan-shape evidence only; it is not p95 evidence.

Before any remote application, record relation sizes and index lock time in
the approved release evidence. If either index is classified as large or the
approved lock window is not met, do not apply version 0002 there. Prepare a
reviewed higher-numbered roll-forward that builds the index concurrently using
an approved non-transactional migration path; the current atomic runner cannot
execute `CREATE INDEX CONCURRENTLY`.

## Verification and recovery

`constraints:verify` compares the target's complete constraint catalog with
the frozen version-0002 catalog. `schema:check` proves canonical SQL is the
exact byte concatenation of ledger migrations and all checksums/counts match.

The existing runner applies pending migrations in one transaction under the
transaction-scoped advisory lock, so an add/validate/index failure rolls back
both schema and ledger writes. After a committed migration, do not edit `0001`
or `0002` and do not delete ledger rows. Correct defects with a reviewed
higher-numbered roll-forward migration. Destructive rollback requires a
separate approved data-retention and recovery plan.

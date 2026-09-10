# Database integrity preflight and version 0002

## Release boundary

Migration `0002_integrity_constraints_indexes` is an append-only ledger entry.
Production application is forbidden until the Slice 11 recovery rehearsal is
approved. No command in `@workspace/db` can apply SQL. The guarded root
`migration:dry-run` is the sole migration orchestration command: it validates
the environment-to-host binding and immutable repository/target ledger through
a read-only connection, plans the named target, and audits success or failure.
It still requires actor, migration, backup, approval, and trusted append-only
audit-descriptor metadata.

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
begin one repeatable-read `TRANSACTION READ ONLY`, set a transaction-local `public, pg_catalog`
search path plus 15-second statement and idle-in-transaction timeouts and a
2-second lock timeout, confirm `transaction_read_only=on`, and commit or roll
back before disconnecting.

## Required staging sequence

Run only under the approved staging read-only identity. These commands are
documented for an authorized operator; they were not run by Slice 10:

```sh
PREFLIGHT_EVIDENCE_FD=3 PREFLIGHT_EVIDENCE_APPEND_ONLY=1 \
  node lib/db/tools/schema-cli.mjs migration:preflight --env staging \
  3>> /secure/evidence/integrity-preflight.jsonl
MIGRATION_AUDIT_FD=3 MIGRATION_AUDIT_APPEND_ONLY=1 \
  node scripts/migration-entrypoint.mjs --env staging --actor RELEASE_ACTOR \
  --migration-id 0002_integrity_constraints_indexes \
  --backup-id BACKUP_ID --approval-id APPROVAL_ID --dry-run \
  3>> /secure/audit/migrations.jsonl
pnpm --filter @workspace/db constraints:verify -- --env staging
pnpm --filter @workspace/db explain:verify -- --env staging
```

`migration:preflight` must report `violations 0; quarantine not-required`.
Any nonzero result exits unsuccessfully. Ordinary stdout is bounded aggregate
evidence only: per-check counts, the total, whether quarantine is required,
and whether protected details were truncated. It never includes row or
relationship identifiers. Detailed candidates are written as JSONL pages of
at most 100 candidates to the launcher-owned regular-file descriptor, with a
hard maximum of 1,000 candidates per run. The launcher must pre-open that
protected append-only evidence file and set both evidence environment values.
For example, stdout has this shape:

```json
{
  "readOnly": true,
  "cleanupPerformed": false,
  "violationCount": "1",
  "checks": [
    {
      "id": "self_block",
      "category": "self_relation",
      "violationCount": "1"
    }
  ],
  "quarantine": {
    "required": true,
    "candidateCount": "1"
  },
  "evidence": {
    "protectedSink": true,
    "candidateLimit": 1000,
    "candidatesWritten": 1,
    "truncated": false
  },
  "approvalTaskRequired": true
}
```

Never copy protected candidate pages into CI logs or ordinary reports. Never
delete, rewrite, reorder, or canonicalize reported candidates during preflight.
Keep the protected sink under release-evidence access controls, quarantine the
listed rows from the release, and open a separate data-remediation change with
explicit owner and approval. Re-run preflight after that separately reviewed
work.

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

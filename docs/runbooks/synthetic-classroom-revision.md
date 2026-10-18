# Existing synthetic classroom revision

This operation revises `mc-synthetic-v1-983-782`. It never inserts users, questions,
requests, applications, comments, events, or schedules, and never changes the
insert receipt or the consumed seed bundle. Do not rerun the insertion tool to
perform a revision.

The reusable entry point is `reviseSyntheticClassroom` in
`ops/revise-synthetic-classroom.mjs`. It accepts an already-connected, idle
PostgreSQL client. It has no executable credential-loading CLI. Source code and
all approval artifacts must be frozen by the separately reviewed owner-run
wrapper before any remote execution. Local test authority fixtures are not
operational backup, restore, writer, or claim evidence.

## Before any apply

1. Freeze the reviewed release SHA, operator and content source hashes, approved
   taxonomy, immutable original apply receipt, exact target (database, role,
   server address and port), revision ID, and representative content preview.
2. Suspend every authorized application writer through its actual control plane.
   The owner-run wrapper must verify the approved service, database project and
   branch/host, release, and fresh control-plane state. The callback must read
   that state again after locks and immediately before COMMIT.
3. Capture a fresh backup of the current target and restore it successfully into
   an isolated local PostgreSQL instance. The current target includes nonbatch
   QA content created after the original seed. Bind the backup hash and restored
   baseline fingerprint to this target, release, schema/catalog, and preview.
   Keep any database backup and before-images private; do not print or publish
   account credentials or messages.
4. Create an exclusive, durable, immutable named revision claim and attempt
   journal before invoking apply. A process crash, validation failure, rollback,
   or uncertain commit consumes the attempt. Never delete or overwrite a claim
   to retry. A separately reviewed recovery action is needed for a consumed
   attempt. No database schema or revision-ledger table is added by this module.

The module deliberately cannot establish that an externally supplied backup or
claim exists: the frozen wrapper owns evidence authenticity and durable one-shot
enforcement. The module verifies freshness and exact digest bindings, and uses
its own database identity, schema, quiescence, locking, and preservation checks.

## API and evidence

Preview call (read-only, rolled back without sequence allocation):

```js
const preview = await reviseSyntheticClassroom({
  client,
  receipt,
  releaseSha,
  expectedTarget: { database, user, serverAddress, serverPort },
});
```

The core transaction and caller-owned baseline helper pin `TimeZone` to UTC with
`SET LOCAL`, so timestamp fingerprints are identical across client defaults.
The helper neither starts nor ends its caller's consistent read-only snapshot.

The preview includes `revisionId`, `previewDigest`, `evidence`, `metadata`, `plan`,
`before`, and unchanged receipt `ids`. `evidence` contains target, whole-baseline,
schema and frozen-catalog digests, release SHA, and preview digest. The returned
plan contains permitted synthetic display changes; `before` contains counts and
hashes, not nonbatch row contents or passwords. Preserve the exact output.

Apply adds:

```js
{
  apply: true,
  expectedPreviewDigest: preview.previewDigest,
  claim: { revisionId, attemptId, previewDigest, releaseSha, state: 'claimed' },
  prerequisites: {
    ...preview.evidence,
    backup: { sha256, createdAt, targetDigest, baselineDigest },
    restore: { backupSha256, verifiedAt, baselineDigest },
    writers: { verifiedAt, targetDigest, releaseSha },
  },
  refreshWriterEvidence: async ({ phase, previewDigest, targetDigest, releaseSha }) => {
    // Perform the real, authorized control-plane read and verify approved scope.
    // Return only a fingerprint of that evidence and its binding metadata.
    return { verifiedAt, targetDigest, releaseSha, evidenceDigest };
  },
}
```

The callback phases are `locked-prewrite` and `precommit`. Backup evidence expires
at 30 minutes; restore and writer evidence expire at 5 minutes. Restore must not
predate the backup. Recreate and review a preview if any current row, password,
metadata, schema/grant, sequence, or target fingerprint has changed. Do not edit
an old preview to make it pass.

## Database guarantees

- The immutable receipt must contain exactly 983 users, 782 questions, 782
  requests, 1,966 schedules, 782 request tags, 782 applications, 391 comments, and
  312 events. Every old generated field must still match the original seed
  plan and its digest, including internal request keys and authentication locks.
- The current migration ledger and actual frozen schema catalog must match 0008.
  District `type` is unrestricted text; elementary metadata needs no migration.
  Row security and noninternal triggers are rejected. Existing Math/Science tag
  IDs and colors, original classroom districts, and all existing rows remain.
- Apply uses READ COMMITTED, a bounded advisory lock, and NOWAIT write-excluding
  locks on every application table and the migration ledger before capturing
  the mutable baseline. This avoids a stale transaction snapshot around locks.
  Other same-database sessions cause rejection; statistics are refreshed for
  every check and redacted backend fields are not filtered away.
- Generic foreign-key inspection rejects any unplanned inbound reference to
  receipt rows, including references from other schemas. Every nonbatch public
  row is hashed, including credential fields, messages, submissions, moderation,
  notifications, and post-seed QA rows. Protected synthetic fields, IDs,
  timestamps, roles, statuses, and schedules must match after the update.
- Only approved district/tag rows can be inserted. Explicit projected IDs avoid
  consuming sequences during preview. `ALTER SEQUENCE ... RESTART WITH` is
  transactional, so a precommit rollback preserves both `last_value` and
  `is_called`. All unrelated sequences remain exactly unchanged.
- The operator verifies district/subject/mentor, question/request,
  application/match/comment/event relationships, exact row counts, all nonbatch
  fingerprints, schema/grants and expected sequence state before COMMIT. Safe role attributes and
  membership grants are separately fingerprinted in `authorityDigest`; role
  authentication secrets are never read. This source-only authority fingerprint
  is separate from portable schema verification in the isolated restore.

## Failures and recovery

Any precommit error rolls back all changes. A thrown COMMIT acknowledgement has
code `REVISION_COMMIT_UNCERTAIN`: the database may already have committed. Never
retry automatically and never interpret a later ROLLBACK as proof of rollback.
Inspect independently with a fresh read-only connection and the frozen manifest.
The original old-state precondition intentionally rejects an already-revised
batch. Keep seed state and revision state separate.

After a confirmed revision, obtain an independent read-only postcommit summary.
Then the operator resumes only approved writers through the control plane and
performs two-account UI, room/DM/history/reconnect checks. Keep writers suspended
when the commit outcome or preservation evidence is uncertain. A reversal requires a reviewed compensating
revision using saved before-images. Do not restore a whole backup over newer
user content.

## Local verification

```sh
PGPASSFILE=/dev/null sh lib/db/test/synthetic-revision-disposable.sh
```

This script starts its own loopback PostgreSQL cluster on a dynamic port, applies
the real migration chain and exact old seed, adds nonbatch accounts and fresh QA
content, runs the operator tests, and removes the disposable cluster. It does not
connect to the default local database or a remote target.

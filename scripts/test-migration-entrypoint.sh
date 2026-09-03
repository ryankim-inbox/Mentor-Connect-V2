#!/usr/bin/env sh
# Regression coverage for the guarded, dry-run-only migration entrypoint.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

run_entrypoint() {
  DATABASE_URL='postgresql://migration-user:secret@staging-db.internal:5432/mentor_connect' \
  MIGRATION_ALLOWED_HOSTS='staging-db.internal' \
  node "$ROOT/scripts/migration-entrypoint.mjs" \
    --env staging \
    --actor release-engineer \
    --migration-id 20260902_add_index \
    --backup-id backup-20260902 \
    --approval-id change-123 \
    --dry-run \
    --audit-log "$TMP/migration-audit.jsonl"
}

run_entrypoint > "$TMP/stdout"

node -e '
  const fs = require("node:fs");
  const [entry] = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
  const required = ["actor", "migrationId", "targetEnvironment", "targetHost", "backupId", "approvalId", "startedAt", "endedAt", "result"];
  for (const field of required) if (!entry[field]) throw new Error(`missing audit field: ${field}`);
  if (entry.actor !== "release-engineer") throw new Error("wrong actor");
  if (entry.migrationId !== "20260902_add_index") throw new Error("wrong migration id");
  if (entry.targetEnvironment !== "staging") throw new Error("wrong environment");
  if (entry.targetHost !== "staging-db.internal") throw new Error("wrong target host");
  if (entry.dryRun !== true || entry.result !== "dry-run-complete") throw new Error("dry-run was not recorded");
' "$TMP/migration-audit.jsonl"

set +e
DATABASE_URL='postgresql://migration-user:secret@production-db.internal:5432/mentor_connect' \
MIGRATION_ALLOWED_HOSTS='staging-db.internal' \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 20260902_add_index \
  --backup-id backup-20260902 --approval-id change-123 --dry-run \
  --audit-log "$TMP/rejected-audit.jsonl" > "$TMP/rejected-stdout" 2> "$TMP/rejected-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'not allowlisted for environment staging' "$TMP/rejected-stderr" > /dev/null
[ ! -e "$TMP/rejected-audit.jsonl" ]

set +e
DATABASE_URL='postgresql://migration-user:secret@staging-db.internal:5432/mentor_connect' \
MIGRATION_ALLOWED_HOSTS='staging-db.internal' \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 20260902_add_index \
  --backup-id backup-20260902 --approval-id change-123 \
  --audit-log "$TMP/non-dry-run-audit.jsonl" > "$TMP/non-dry-run-stdout" 2> "$TMP/non-dry-run-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'only supports --dry-run' "$TMP/non-dry-run-stderr" > /dev/null
[ ! -e "$TMP/non-dry-run-audit.jsonl" ]

echo "migration entrypoint tests passed"

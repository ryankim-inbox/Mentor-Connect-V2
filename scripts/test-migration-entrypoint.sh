#!/usr/bin/env sh
# Regression coverage for the guarded, dry-run-only migration entrypoint.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
AUDIT_FILE="$TMP/migration-audit.jsonl"
touch "$AUDIT_FILE"

run_unreachable_entrypoint() {
  DATABASE_URL='postgresql://staging-db.internal/classroom' \
  MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
  MIGRATION_ALLOWED_HOSTS_PRODUCTION='production-db.internal' \
  MIGRATION_AUDIT_FD=3 \
  MIGRATION_AUDIT_APPEND_ONLY=1 \
  node "$ROOT/scripts/migration-entrypoint.mjs" \
    --env staging \
    --actor release-engineer \
    --migration-id 0002_integrity_constraints_indexes \
    --backup-id backup-20260902 \
    --approval-id change-123 \
    --dry-run \
    3>> "$AUDIT_FILE"
}

set +e
DATABASE_URL='postgresql://staging-db.internal/classroom' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_AUDIT_FD=3 \
MIGRATION_AUDIT_APPEND_ONLY=1 \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 9999_not_in_ledger \
  --backup-id backup-20260902 --approval-id change-123 --dry-run \
  3>> "$AUDIT_FILE" > "$TMP/unknown-stdout" 2> "$TMP/unknown-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'migration is not present in the immutable ledger' "$TMP/unknown-stderr" > /dev/null
node -e '
  const fs = require("node:fs");
  const entries = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
  const entry = entries.at(-1);
  if (entry.migrationId !== "9999_not_in_ledger") throw new Error("wrong failed migration id");
  if (entry.result !== "dry-run-failed") throw new Error("failure was not audited");
  if (entry.failureCode !== "migration_not_in_ledger") throw new Error("failure code is ambiguous");
' "$AUDIT_FILE"

set +e
run_unreachable_entrypoint > "$TMP/unreachable-stdout" 2> "$TMP/unreachable-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'read-only migration planning could not connect to the approved target' "$TMP/unreachable-stderr" > /dev/null
! grep -F 'secret' "$TMP/unreachable-stdout" "$TMP/unreachable-stderr" > /dev/null
node -e '
  const fs = require("node:fs");
  const entries = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map(JSON.parse);
  const entry = entries.at(-1);
  const required = ["actor", "migrationId", "targetEnvironment", "targetHost", "targetPort", "targetDatabase", "backupId", "approvalId", "startedAt", "endedAt", "result"];
  for (const field of required) if (!entry[field]) throw new Error(`missing audit field: ${field}`);
  if (entry.actor !== "release-engineer") throw new Error("wrong actor");
  if (entry.migrationId !== "0002_integrity_constraints_indexes") throw new Error("wrong migration id");
  if (entry.targetEnvironment !== "staging") throw new Error("wrong environment");
  if (entry.targetHost !== "staging-db.internal") throw new Error("wrong target host");
  if (entry.targetPort !== "5432" || entry.targetDatabase !== "classroom") throw new Error("target identity is incomplete");
  if (entry.dryRun !== true || entry.result !== "dry-run-failed") throw new Error("failed dry-run was not recorded");
  if (entry.failureCode !== "database_connection_failed") throw new Error("connection failure code is ambiguous");
' "$AUDIT_FILE"

set +e
DATABASE_URL='postgresql://staging-db.internal/classroom' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_ALLOWED_HOSTS_PRODUCTION='production-db.internal' \
MIGRATION_AUDIT_APPEND_ONLY=1 \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 20260902_add_index \
  --backup-id backup-20260902 --approval-id change-123 --dry-run > "$TMP/missing-fd-stdout" 2> "$TMP/missing-fd-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'MIGRATION_AUDIT_FD is required' "$TMP/missing-fd-stderr" > /dev/null

set +e
DATABASE_URL='postgresql://staging-db.internal/classroom' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_ALLOWED_HOSTS_PRODUCTION='production-db.internal' \
MIGRATION_AUDIT_FD=not-a-fd \
MIGRATION_AUDIT_APPEND_ONLY=1 \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 20260902_add_index \
  --backup-id backup-20260902 --approval-id change-123 --dry-run > "$TMP/invalid-fd-stdout" 2> "$TMP/invalid-fd-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'MIGRATION_AUDIT_FD must be a non-negative integer' "$TMP/invalid-fd-stderr" > /dev/null

set +e
DATABASE_URL='postgresql://staging-db.internal/classroom' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_ALLOWED_HOSTS_PRODUCTION='production-db.internal' \
MIGRATION_AUDIT_FD=3 \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 20260902_add_index \
  --backup-id backup-20260902 --approval-id change-123 --dry-run \
  3>> "$AUDIT_FILE" > "$TMP/missing-append-stdout" 2> "$TMP/missing-append-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'MIGRATION_AUDIT_APPEND_ONLY=1 is required' "$TMP/missing-append-stderr" > /dev/null

set +e
DATABASE_URL='postgresql://staging-db.internal/classroom' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_ALLOWED_HOSTS_PRODUCTION='production-db.internal' \
MIGRATION_AUDIT_FD=3 \
MIGRATION_AUDIT_APPEND_ONLY=1 \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 20260902_add_index \
  --backup-id backup-20260902 --approval-id change-123 --dry-run \
  3>> /dev/null > "$TMP/device-stdout" 2> "$TMP/device-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'MIGRATION_AUDIT_FD must reference a regular file' "$TMP/device-stderr" > /dev/null

set +e
DATABASE_URL='postgresql://production-db.internal/classroom' \
MIGRATION_ALLOWED_HOSTS='staging-db.internal,production-db.internal' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_ALLOWED_HOSTS_PRODUCTION='production-db.internal' \
MIGRATION_AUDIT_FD=3 \
MIGRATION_AUDIT_APPEND_ONLY=1 \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 20260902_add_index \
  --backup-id backup-20260902 --approval-id change-123 --dry-run \
  3>> "$AUDIT_FILE" > "$TMP/rejected-stdout" 2> "$TMP/rejected-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'not allowlisted for environment staging' "$TMP/rejected-stderr" > /dev/null

set +e
DATABASE_URL='postgresql://staging-db.internal/classroom' \
MIGRATION_ALLOWED_HOSTS_STAGING='staging-db.internal' \
MIGRATION_ALLOWED_HOSTS_PRODUCTION='production-db.internal' \
MIGRATION_AUDIT_FD=3 \
node "$ROOT/scripts/migration-entrypoint.mjs" \
  --env staging --actor release-engineer --migration-id 20260902_add_index \
  --backup-id backup-20260902 --approval-id change-123 \
  3>> "$AUDIT_FILE" > "$TMP/non-dry-run-stdout" 2> "$TMP/non-dry-run-stderr"
STATUS=$?
set -e

[ "$STATUS" -ne 0 ]
grep -F 'only supports --dry-run' "$TMP/non-dry-run-stderr" > /dev/null

echo "migration entrypoint tests passed"

#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../../.." && pwd)
FIXTURE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/mc-ops.XXXXXX")
CLUSTER_DIR="$FIXTURE_DIR/cluster"
SOCKET_DIR="$FIXTURE_DIR/socket"
mkdir "$SOCKET_DIR"
PORT=$(node -e 'const net = require("node:net"); const server = net.createServer(); server.listen(0, "127.0.0.1", () => { console.log(server.address().port); server.close(); });')
STARTED=0

cleanup() {
  if [ "$STARTED" -eq 1 ]; then
    pg_ctl -D "$CLUSTER_DIR" -m immediate -w stop >/dev/null
  fi
  rm -rf "$FIXTURE_DIR"
}
trap cleanup EXIT HUP INT TERM

initdb -D "$CLUSTER_DIR" --no-locale --encoding=UTF8 --auth=trust >/dev/null
pg_ctl -D "$CLUSTER_DIR" -o "-F -h 127.0.0.1 -p $PORT -k $SOCKET_DIR" -w start >/dev/null
STARTED=1
DATABASE_URL="postgresql://127.0.0.1:$PORT/postgres"
export DATABASE_URL

pnpm --dir "$ROOT/lib/db" exec node --input-type=module -e '
  import pg from "pg";
  import { loadMigrationLedger } from "./tools/migration-ledger.mjs";
  import { runMigrationTransaction } from "./tools/migration-runner.mjs";
  const ledger = await loadMigrationLedger({ rootDir: "../.." });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await runMigrationTransaction({
      client,
      ledger: { ...ledger, migrations: [ledger.migrations[0]] },
      appSha: "a".repeat(40),
    });
  } finally {
    await client.end();
  }
'

PREFLIGHT_EVIDENCE_FD=3 PREFLIGHT_EVIDENCE_APPEND_ONLY=1 \
  node "$ROOT/lib/db/tools/schema-cli.mjs" migration:preflight --env local \
  3>> "$FIXTURE_DIR/preflight.jsonl"

MIGRATION_ALLOWED_HOSTS_STAGING=127.0.0.1 \
MIGRATION_AUDIT_FD=3 \
MIGRATION_AUDIT_APPEND_ONLY=1 \
  node "$ROOT/scripts/migration-entrypoint.mjs" \
    --env staging \
    --actor release-test \
    --migration-id 0002_integrity_constraints_indexes \
    --backup-id backup-test \
    --approval-id approval-test \
    --dry-run \
    3>> "$FIXTURE_DIR/audit.jsonl"

pnpm --dir "$ROOT/lib/db" exec node --input-type=module -e '
  import pg from "pg";
  import { loadMigrationLedger } from "./tools/migration-ledger.mjs";
  import { runMigrationTransaction } from "./tools/migration-runner.mjs";
  const ledger = await loadMigrationLedger({ rootDir: "../.." });
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await runMigrationTransaction({
      client,
      ledger,
      appSha: "b".repeat(40),
    });
    await client.query(`
      INSERT INTO districts (id, name, county)
      SELECT value, $sql$District $sql$ || value, $sql$County$sql$
      FROM generate_series(1, 100) AS value;
      INSERT INTO tags (id, name)
      SELECT value, $sql$Tag $sql$ || value
      FROM generate_series(1, 100) AS value;
      INSERT INTO users
        (id, email, name, password_hash, role, district_id, is_verified)
      SELECT
        value,
        $sql$user-$sql$ || lpad(value::text, 5, $sql$0$sql$) || $sql$@example.test$sql$,
        $sql$User $sql$ || value,
        $sql$hash$sql$,
        CASE WHEN value % 2 = 0 THEN $sql$mentor$sql$ ELSE $sql$mentee$sql$ END,
        (value % 100) + 1,
        value % 20 <> 0
      FROM generate_series(1, 5000) AS value;
      INSERT INTO requests
        (id, author_id, district_id, title, description, role, status)
      SELECT
        value,
        value,
        (value % 100) + 1,
        $sql$Request $sql$ || value,
        $sql$Description$sql$,
        CASE WHEN value % 2 = 0 THEN $sql$mentor$sql$ ELSE $sql$mentee$sql$ END,
        CASE WHEN value % 100 = 0 THEN $sql$open$sql$ ELSE $sql$closed$sql$ END
      FROM generate_series(1, 5000) AS value;
      INSERT INTO request_tags (request_id, tag_id)
      SELECT value, (value % 100) + 1
      FROM generate_series(1, 5000) AS value;
      ANALYZE users;
      ANALYZE requests;
      ANALYZE request_tags;
    `);
  } finally {
    await client.end();
  }
'

pnpm --dir "$ROOT/lib/db" constraints:verify -- --env local
pnpm --dir "$ROOT/lib/db" explain:verify -- --env local

node -e '
  const fs = require("node:fs");
  const audit = JSON.parse(fs.readFileSync(process.argv[1], "utf8").trim());
  if (audit.result !== "dry-run-validated") throw new Error("dry-run result was not validated");
  if (audit.plannedMigrationCount !== 1) throw new Error("unexpected plan length");
  if (audit.appliedTail !== "0001_canonical_baseline") throw new Error("wrong applied tail");
  if (fs.readFileSync(process.argv[2], "utf8") !== "") throw new Error("zero-violation preflight wrote candidates");
' "$FIXTURE_DIR/audit.jsonl" "$FIXTURE_DIR/preflight.jsonl"

echo "four disposable operator commands passed"

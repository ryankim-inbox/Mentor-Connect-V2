import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { diffCatalog, introspectCatalog } from "./catalog.mjs";
import { validateAppliedMigrations } from "./migration-ledger.mjs";
import { verifySchemaAssets } from "./schema-assets.mjs";

const { Client } = pg;
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
async function verifyRepository() {
  return verifySchemaAssets({ rootDir });
}

function databaseUrl() {
  if (!process.env.DATABASE_URL)
    throw new Error(
      "DATABASE_URL is required for read-only database inspection",
    );
  return process.env.DATABASE_URL;
}

async function withDatabase(run) {
  const client = new Client({
    connectionString: databaseUrl(),
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

async function readAppliedMigrations(client) {
  await client.query("BEGIN TRANSACTION READ ONLY");
  try {
    const mode = await client.query("SHOW transaction_read_only");
    if (mode.rows[0]?.transaction_read_only !== "on") {
      throw new Error("migration status requires a read-only transaction");
    }
    const relation = await client.query(
      "SELECT to_regclass('public.mentor_connect_schema_migrations') AS name",
    );
    let rows = [];
    if (relation.rows[0]?.name) {
      const applied = await client.query(`
        SELECT ordinal, migration_id AS "migrationId", checksum,
               applied_at AS "appliedAt", app_sha AS "appSha"
        FROM public.mentor_connect_schema_migrations
        ORDER BY ordinal
      `);
      rows = applied.rows;
    }
    await client.query("COMMIT");
    return rows;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function schemaCheck(args) {
  if (args.length !== 0)
    throw new Error("schema:check does not accept arguments");
  const { version, catalog, ledger } = await verifyRepository();
  console.log(
    `schema check: ok (version ${version.schemaVersion}, ${catalog.tables.length} tables, ${ledger.migrations.length} migration)`,
  );
}

async function migrationStatus(args) {
  if (args.length !== 0)
    throw new Error("migration:status does not accept arguments");
  const { version, ledger } = await verifyRepository();
  const applied = await withDatabase((client) => readAppliedMigrations(client));
  const pending = validateAppliedMigrations(ledger.migrations, applied);
  console.log(`migration status: version ${version.schemaVersion} (read-only)`);
  console.log(
    `applied: ${applied.length}${applied.length ? ` (${applied.map((row) => row.migrationId).join(", ")})` : ""}`,
  );
  console.log(
    `pending: ${pending.length}${pending.length ? ` (${pending.map((migration) => migration.id).join(", ")})` : ""}`,
  );
}

async function schemaDiff(args) {
  const normalizedArgs = args[0] === "--" ? args.slice(1) : args;
  if (normalizedArgs.length !== 1 || normalizedArgs[0] !== "--read-only") {
    throw new Error(
      "--read-only is required and is the only supported schema:diff option",
    );
  }
  const { catalog } = await verifyRepository();
  const actual = await withDatabase((client) => introspectCatalog(client));
  const differences = diffCatalog(catalog, actual);
  console.log(`schema diff: ${differences.length} (read-only)`);
  for (const difference of differences) console.log(`- ${difference}`);
  if (differences.length > 0) process.exitCode = 1;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "schema:check") return schemaCheck(args);
  if (command === "migration:status") return migrationStatus(args);
  if (command === "schema:diff") return schemaDiff(args);
  throw new Error(
    "command must be schema:check, migration:status, or schema:diff",
  );
}

main().catch((error) => {
  console.error(`schema tool rejected: ${error.message}`);
  process.exitCode = 1;
});

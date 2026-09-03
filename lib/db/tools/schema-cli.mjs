import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

import { diffCatalog, introspectCatalog } from "./catalog.mjs";
import {
  loadMigrationLedger,
  validateAppliedMigrations,
} from "./migration-ledger.mjs";

const { Client } = pg;
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const schemaDirectory = path.join(rootDir, "database/schema");

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function loadCanonicalAssets() {
  const versionPath = path.join(schemaDirectory, "version.json");
  const version = JSON.parse(await readFile(versionPath, "utf8"));
  if (
    version.formatVersion !== 1 ||
    !/^\d{4,}$/.test(version.schemaVersion ?? "")
  ) {
    throw new Error("schema version manifest is invalid");
  }
  if (path.basename(version.canonicalFile ?? "") !== version.canonicalFile) {
    throw new Error("canonicalFile must be a file in database/schema");
  }
  if (path.basename(version.catalogFile ?? "") !== version.catalogFile) {
    throw new Error("catalogFile must be a file in database/schema");
  }
  const [canonicalSql, catalogContents] = await Promise.all([
    readFile(path.join(schemaDirectory, version.canonicalFile), "utf8"),
    readFile(path.join(schemaDirectory, version.catalogFile), "utf8"),
  ]);
  if (sha256(canonicalSql) !== version.canonicalSha256) {
    throw new Error("canonical schema checksum mismatch");
  }
  if (sha256(catalogContents) !== version.catalogSha256) {
    throw new Error("frozen catalog checksum mismatch");
  }
  const catalog = JSON.parse(catalogContents);
  for (const [field, actual] of [
    ["tableCount", catalog.tables?.length],
    ["columnCount", catalog.columns?.length],
    ["constraintCount", catalog.constraints?.length],
    ["indexCount", catalog.indexes?.length],
  ]) {
    if (version[field] !== actual) {
      throw new Error(`${field} does not match the frozen catalog`);
    }
  }
  if (version.productionStatus !== "[UNKNOWN]") {
    throw new Error(
      "productionStatus must remain [UNKNOWN] until read-only production evidence exists",
    );
  }
  return { version, catalog, canonicalSql };
}

async function verifyRepository() {
  const [{ version, catalog }, ledger] = await Promise.all([
    loadCanonicalAssets(),
    loadMigrationLedger({ rootDir }),
  ]);
  const baseline = ledger.migrations[0];
  if (
    baseline.sequence.toString().padStart(version.schemaVersion.length, "0") !==
    version.schemaVersion
  ) {
    throw new Error(
      "schema version does not match the baseline migration sequence",
    );
  }
  if (baseline.path !== `database/schema/${version.canonicalFile}`) {
    throw new Error(
      "baseline migration must reference the canonical schema directly",
    );
  }
  if (baseline.sha256 !== version.canonicalSha256) {
    throw new Error(
      "baseline migration checksum does not match the canonical schema",
    );
  }
  return { version, catalog, ledger };
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

import path from "node:path";
import { fileURLToPath } from "node:url";
import { fstatSync, writeSync } from "node:fs";

import pg from "pg";

import { diffCatalog, introspectCatalog } from "./catalog.mjs";
import {
  parseEnvironmentArguments,
  validateDatabaseTarget,
} from "./environment.mjs";
import {
  runIntegrityPreflight,
  verifyConstraintCatalog,
  verifyExplainPlans,
} from "./integrity.mjs";
import { validateAppliedMigrations } from "./migration-ledger.mjs";
import { verifyLegacyFixtures } from "./legacy-fixture.mjs";
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

function protectedEvidenceDescriptor() {
  const rawDescriptor = process.env.PREFLIGHT_EVIDENCE_FD;
  if (rawDescriptor === undefined) {
    throw new Error("PREFLIGHT_EVIDENCE_FD is required");
  }
  if (!/^\d+$/.test(rawDescriptor)) {
    throw new Error("PREFLIGHT_EVIDENCE_FD must be a non-negative integer");
  }
  const descriptor = Number(rawDescriptor);
  if (!Number.isSafeInteger(descriptor)) {
    throw new Error("PREFLIGHT_EVIDENCE_FD must be a non-negative integer");
  }
  if (process.env.PREFLIGHT_EVIDENCE_APPEND_ONLY !== "1") {
    throw new Error(
      "PREFLIGHT_EVIDENCE_APPEND_ONLY=1 is required from the evidence launcher",
    );
  }
  let status;
  try {
    status = fstatSync(descriptor);
  } catch {
    throw new Error(
      "PREFLIGHT_EVIDENCE_FD must reference an open regular file",
    );
  }
  if (!status.isFile()) {
    throw new Error("PREFLIGHT_EVIDENCE_FD must reference a regular file");
  }
  return descriptor;
}

function appendEvidencePage(descriptor, page) {
  const payload = Buffer.from(`${JSON.stringify(page)}\n`, "utf8");
  let offset = 0;
  while (offset < payload.length) {
    const written = writeSync(
      descriptor,
      payload,
      offset,
      payload.length - offset,
      null,
    );
    if (written <= 0) {
      throw new Error(
        "protected evidence sink did not accept the complete page",
      );
    }
    offset += written;
  }
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

function validateInspectionTarget(environment) {
  return validateDatabaseTarget({
    environment,
    databaseUrl: databaseUrl(),
    processEnvironment: process.env,
  });
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
  const fixture = await verifyLegacyFixtures({
    rootDir,
    currentSchemaVersion: version.schemaVersion,
  });
  console.log(
    `schema check: ok (version ${version.schemaVersion}, ${catalog.tables.length} tables, ${ledger.migrations.length} migration)`,
  );
  console.log(
    `legacy fixture: ${fixture.schemaCompatibility} (current schema ${version.schemaVersion} incompatible; deployment ${fixture.deploymentUse})`,
  );
}

async function fixtureCheck(args) {
  if (args.length !== 0)
    throw new Error("fixture:check does not accept arguments");
  const { version } = await verifyRepository();
  const fixture = await verifyLegacyFixtures({
    rootDir,
    currentSchemaVersion: version.schemaVersion,
  });
  console.log(
    `legacy fixture check: ${fixture.id}; ${fixture.schemaCompatibility}; current schema ${version.schemaVersion} incompatible; deployment ${fixture.deploymentUse}`,
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

async function migrationPreflight(args) {
  const { environment } = parseEnvironmentArguments(args);
  validateInspectionTarget(environment);
  const { version } = await verifyRepository();
  const evidenceDescriptor = protectedEvidenceDescriptor();
  const evidence = await withDatabase((client) =>
    runIntegrityPreflight(client, {
      writeEvidencePage(page) {
        appendEvidencePage(evidenceDescriptor, {
          schemaVersion: version.schemaVersion,
          targetEnvironment: environment,
          ...page,
        });
      },
    }),
  );
  console.log(
    `migration preflight: schema ${version.schemaVersion}; target ${environment}; violations ${evidence.violationCount}; quarantine ${evidence.quarantine.required ? "required" : "not-required"}`,
  );
  console.log(
    JSON.stringify({
      schemaVersion: version.schemaVersion,
      targetEnvironment: environment,
      ...evidence,
    }),
  );
  if (evidence.violationCount > 0) process.exitCode = 1;
}

async function constraintsVerify(args) {
  const { environment } = parseEnvironmentArguments(args);
  validateInspectionTarget(environment);
  const { catalog, version } = await verifyRepository();
  const result = await withDatabase((client) =>
    verifyConstraintCatalog(client, catalog.constraints),
  );
  console.log(
    `constraints verify: schema ${version.schemaVersion}; target ${environment}; constraint differences ${result.differences.length} (read-only)`,
  );
  for (const difference of result.differences) console.log(`- ${difference}`);
  if (result.differences.length > 0) process.exitCode = 1;
}

async function explainVerify(args) {
  const { environment } = parseEnvironmentArguments(args);
  validateInspectionTarget(environment);
  const result = await withDatabase((client) => verifyExplainPlans(client));
  const passed = result.queries.length - result.failures.length;
  console.log(
    `explain verify: target ${environment}; query plans ${passed}/${result.queries.length} expected (read-only)`,
  );
  console.log(JSON.stringify(result));
  if (result.failures.length > 0) process.exitCode = 1;
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "schema:check") return schemaCheck(args);
  if (command === "fixture:check") return fixtureCheck(args);
  if (command === "migration:status") return migrationStatus(args);
  if (command === "schema:diff") return schemaDiff(args);
  if (command === "migration:preflight") return migrationPreflight(args);
  if (command === "constraints:verify") return constraintsVerify(args);
  if (command === "explain:verify") return explainVerify(args);
  throw new Error("unsupported schema tool command");
}

main().catch((error) => {
  console.error(`schema tool rejected: ${error.message}`);
  process.exitCode = 1;
});

import { fstatSync, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifySchemaAssets } from "../lib/db/tools/schema-assets.mjs";
import { planMigrationDryRun } from "../lib/db/tools/migration-plan.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const valueOptions = new Set([
  "--env",
  "--actor",
  "--migration-id",
  "--backup-id",
  "--approval-id",
]);
const requiredOptions = [...valueOptions];
const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(message, failureCode = "entrypoint_rejected") {
  const error = new Error(message);
  error.failureCode = failureCode;
  throw error;
}

function parseArguments(argv) {
  const options = new Map();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      if (options.has(argument)) fail("--dry-run may only be provided once");
      options.set(argument, true);
      continue;
    }
    if (!valueOptions.has(argument)) fail(`unsupported argument: ${argument}`);
    if (options.has(argument)) fail(`${argument} may only be provided once`);

    const value = argv[index + 1];
    if (!value || value.startsWith("--")) fail(`${argument} requires a value`);
    options.set(argument, value);
    index += 1;
  }

  for (const option of requiredOptions) {
    if (!options.has(option)) fail(`${option} is required`);
  }
  if (options.get("--dry-run") !== true) {
    fail(
      "migration entrypoint only supports --dry-run until a migration runner is approved",
    );
  }

  return options;
}

function validateMetadata(options) {
  const environment = options.get("--env");
  if (environment !== "staging" && environment !== "production") {
    fail("--env must be staging or production");
  }

  for (const option of [
    "--actor",
    "--migration-id",
    "--backup-id",
    "--approval-id",
  ]) {
    if (!safeIdentifier.test(options.get(option))) {
      fail(
        `${option} must contain only letters, digits, dots, underscores, or hyphens`,
      );
    }
  }
}

function validatedTarget(environment) {
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");
  const allowlistVariable = `MIGRATION_ALLOWED_HOSTS_${environment.toUpperCase()}`;
  if (!process.env[allowlistVariable]) fail(`${allowlistVariable} is required`);

  let databaseUrl;
  try {
    databaseUrl = new URL(process.env.DATABASE_URL);
  } catch {
    fail("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (
    databaseUrl.protocol !== "postgresql:" &&
    databaseUrl.protocol !== "postgres:"
  ) {
    fail("DATABASE_URL must use the postgresql protocol");
  }
  if (!databaseUrl.hostname) fail("DATABASE_URL must include a host");

  const allowedHosts = process.env[allowlistVariable]
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHosts.length === 0)
    fail(`${allowlistVariable} must list at least one host`);

  const targetHost = databaseUrl.hostname.toLowerCase();
  if (!allowedHosts.includes(targetHost)) {
    fail(`DATABASE_URL host is not allowlisted for environment ${environment}`);
  }
  let targetDatabase;
  try {
    targetDatabase = decodeURIComponent(databaseUrl.pathname.slice(1));
  } catch {
    fail("DATABASE_URL database name must use valid percent encoding");
  }
  if (!targetDatabase || targetDatabase.includes("/")) {
    fail("DATABASE_URL must identify exactly one database");
  }
  return {
    databaseUrl: process.env.DATABASE_URL,
    targetHost,
    targetPort: databaseUrl.port || "5432",
    targetDatabase,
  };
}

function validatedAuditSink() {
  const rawDescriptor = process.env.MIGRATION_AUDIT_FD;
  if (rawDescriptor === undefined) fail("MIGRATION_AUDIT_FD is required");
  if (!/^\d+$/.test(rawDescriptor)) {
    fail("MIGRATION_AUDIT_FD must be a non-negative integer");
  }
  const descriptor = Number(rawDescriptor);
  if (!Number.isSafeInteger(descriptor)) {
    fail("MIGRATION_AUDIT_FD must be a non-negative integer");
  }
  if (process.env.MIGRATION_AUDIT_APPEND_ONLY !== "1") {
    fail("MIGRATION_AUDIT_APPEND_ONLY=1 is required from the audit launcher");
  }

  let sinkStatus;
  try {
    sinkStatus = fstatSync(descriptor);
  } catch {
    fail("MIGRATION_AUDIT_FD must reference an open regular file");
  }
  if (!sinkStatus.isFile()) {
    fail("MIGRATION_AUDIT_FD must reference a regular file");
  }

  return descriptor;
}

function appendAuditEntry(descriptor, entry) {
  const payload = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
  let offset = 0;
  while (offset < payload.length) {
    const written = writeSync(
      descriptor,
      payload,
      offset,
      payload.length - offset,
      null,
    );
    if (written <= 0) fail("audit sink did not accept the complete entry");
    offset += written;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  validateMetadata(options);
  const target = validatedTarget(options.get("--env"));
  const auditDescriptor = validatedAuditSink();
  const startedAt = new Date().toISOString();
  const entry = {
    actor: options.get("--actor"),
    migrationId: options.get("--migration-id"),
    targetEnvironment: options.get("--env"),
    targetHost: target.targetHost,
    targetPort: target.targetPort,
    targetDatabase: target.targetDatabase,
    backupId: options.get("--backup-id"),
    approvalId: options.get("--approval-id"),
    dryRun: true,
    startedAt,
  };

  try {
    const { ledger } = await verifySchemaAssets({ rootDir });
    const plan = await planMigrationDryRun({
      databaseUrl: target.databaseUrl,
      ledger,
      migrationId: entry.migrationId,
    });
    appendAuditEntry(auditDescriptor, {
      ...entry,
      ...plan,
      endedAt: new Date().toISOString(),
      result: "dry-run-validated",
    });
    console.log(
      `migration dry-run validated a read-only plan of ${plan.plannedMigrationCount} migration(s); no database changes were executed`,
    );
  } catch (error) {
    appendAuditEntry(auditDescriptor, {
      ...entry,
      endedAt: new Date().toISOString(),
      result: "dry-run-failed",
      failureCode: error.failureCode ?? "validation_failed",
    });
    throw error;
  }
}

main().catch((error) => {
  console.error(`migration entrypoint rejected: ${error.message}`);
  process.exitCode = 1;
});

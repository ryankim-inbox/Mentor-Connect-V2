import { appendFile, lstat, realpath } from "node:fs/promises";
import path from "node:path";

const valueOptions = new Set([
  "--env",
  "--actor",
  "--migration-id",
  "--backup-id",
  "--approval-id",
  "--audit-log",
]);
const requiredOptions = [...valueOptions];
const safeIdentifier = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(message) {
  throw new Error(message);
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
    fail("migration entrypoint only supports --dry-run until a migration runner is approved");
  }

  return options;
}

function validateMetadata(options) {
  const environment = options.get("--env");
  if (environment !== "staging" && environment !== "production") {
    fail("--env must be staging or production");
  }

  for (const option of ["--actor", "--migration-id", "--backup-id", "--approval-id"]) {
    if (!safeIdentifier.test(options.get(option))) {
      fail(`${option} must contain only letters, digits, dots, underscores, or hyphens`);
    }
  }
}

function validatedTargetHost(environment) {
  if (!process.env.DATABASE_URL) fail("DATABASE_URL is required");
  const allowlistVariable = `MIGRATION_ALLOWED_HOSTS_${environment.toUpperCase()}`;
  if (!process.env[allowlistVariable]) fail(`${allowlistVariable} is required`);

  let databaseUrl;
  try {
    databaseUrl = new URL(process.env.DATABASE_URL);
  } catch {
    fail("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (databaseUrl.protocol !== "postgresql:" && databaseUrl.protocol !== "postgres:") {
    fail("DATABASE_URL must use the postgresql protocol");
  }
  if (!databaseUrl.hostname) fail("DATABASE_URL must include a host");

  const allowedHosts = process.env[allowlistVariable].split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (allowedHosts.length === 0) fail(`${allowlistVariable} must list at least one host`);

  const targetHost = databaseUrl.hostname.toLowerCase();
  if (!allowedHosts.includes(targetHost)) {
    fail(`DATABASE_URL host is not allowlisted for environment ${environment}`);
  }
  return targetHost;
}

async function validatedAuditDestination(options) {
  const configuredDestination = process.env.MIGRATION_AUDIT_LOG;
  const requestedDestination = options.get("--audit-log");
  if (!configuredDestination) fail("MIGRATION_AUDIT_LOG is required");
  if (requestedDestination !== configuredDestination) {
    fail("--audit-log must match configured MIGRATION_AUDIT_LOG");
  }
  if (!path.isAbsolute(configuredDestination)) {
    fail("MIGRATION_AUDIT_LOG must be an absolute path");
  }

  const configuredDirectory = path.dirname(configuredDestination);
  let resolvedDirectory;
  try {
    resolvedDirectory = await realpath(configuredDirectory);
  } catch {
    fail("MIGRATION_AUDIT_LOG parent directory must exist");
  }
  if (configuredDirectory !== resolvedDirectory) {
    fail("MIGRATION_AUDIT_LOG parent directory must not be a symbolic link");
  }

  try {
    const destinationStatus = await lstat(configuredDestination);
    if (destinationStatus.isSymbolicLink()) {
      fail("MIGRATION_AUDIT_LOG must not be a symbolic link");
    }
    if (!destinationStatus.isFile()) {
      fail("MIGRATION_AUDIT_LOG must be a regular file");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  return configuredDestination;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  validateMetadata(options);
  const targetHost = validatedTargetHost(options.get("--env"));
  const auditDestination = await validatedAuditDestination(options);
  const startedAt = new Date().toISOString();
  const endedAt = new Date().toISOString();
  const entry = {
    actor: options.get("--actor"),
    migrationId: options.get("--migration-id"),
    targetEnvironment: options.get("--env"),
    targetHost,
    backupId: options.get("--backup-id"),
    approvalId: options.get("--approval-id"),
    dryRun: true,
    startedAt,
    endedAt,
    result: "dry-run-complete",
  };

  await appendFile(auditDestination, `${JSON.stringify(entry)}\n`, "utf8");
  console.log("migration dry-run guard completed; no database changes were executed");
}

main().catch((error) => {
  console.error(`migration entrypoint rejected: ${error.message}`);
  process.exitCode = 1;
});

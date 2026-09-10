const ENVIRONMENTS = new Set(["local", "staging", "production"]);
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

function fail(message) {
  throw new Error(message);
}

export function parseEnvironmentArguments(args) {
  const normalized = args[0] === "--" ? args.slice(1) : args;
  let environment;
  for (let index = 0; index < normalized.length; index += 1) {
    const argument = normalized[index];
    if (argument !== "--env") fail(`unsupported argument: ${argument}`);
    if (environment !== undefined) fail("--env may only be provided once");
    const value = normalized[index + 1];
    if (!value || value.startsWith("--")) fail("--env requires a value");
    environment = value;
    index += 1;
  }
  if (!ENVIRONMENTS.has(environment)) {
    fail("--env must be local, staging, or production");
  }
  return { environment };
}

export function validateDatabaseTarget({
  environment,
  databaseUrl,
  processEnvironment,
}) {
  if (!databaseUrl) fail("DATABASE_URL is required for read-only inspection");
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    fail("DATABASE_URL must use the postgresql protocol");
  }
  const hostname = parsed.hostname
    .toLowerCase()
    .replace(/^\[([^\]]+)\]$/, "$1");
  if (!hostname) fail("DATABASE_URL must include a host");

  if (environment === "local") {
    if (!LOOPBACK_HOSTS.has(hostname)) {
      fail("local inspection requires a loopback database host");
    }
  } else {
    const variable = `MIGRATION_ALLOWED_HOSTS_${environment.toUpperCase()}`;
    const allowlist = (processEnvironment[variable] ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (allowlist.length === 0) fail(`${variable} is required`);
    if (!allowlist.includes(hostname)) {
      fail(
        `DATABASE_URL host is not allowlisted for environment ${environment}`,
      );
    }
  }
  return { hostname };
}

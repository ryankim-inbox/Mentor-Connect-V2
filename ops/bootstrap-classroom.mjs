import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrationTransaction } from "../lib/db/tools/migration-runner.mjs";
import { verifySchemaAssets } from "../lib/db/tools/schema-assets.mjs";

const { Client } = createRequire(
  new URL("../lib/db/package.json", import.meta.url),
)("pg");

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const TLS_OPTIONS = new Set([
  "ssl",
  "sslcert",
  "sslkey",
  "sslmode",
  "sslrootcert",
  "uselibpqcompat",
]);

export function validateClassroomTarget({
  databaseUrl,
  allowedHost,
  databaseName,
}) {
  if (!databaseUrl || !allowedHost || !databaseName) {
    throw new Error(
      "CLASSROOM_DATABASE_URL, CLASSROOM_ALLOWED_HOST, and CLASSROOM_DATABASE_NAME are required",
    );
  }
  let target;
  try {
    target = new URL(databaseUrl);
  } catch {
    throw new Error("CLASSROOM_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (target.protocol !== "postgresql:" && target.protocol !== "postgres:") {
    throw new Error("CLASSROOM_DATABASE_URL must use the postgresql protocol");
  }
  if (target.hash) {
    throw new Error("CLASSROOM_DATABASE_URL must not contain a fragment");
  }
  const seenOptions = new Set();
  for (const [option] of target.searchParams) {
    if (!TLS_OPTIONS.has(option)) {
      throw new Error(`unsupported classroom database URL option: ${option}`);
    }
    if (seenOptions.has(option)) {
      throw new Error(`duplicate classroom database URL option: ${option}`);
    }
    seenOptions.add(option);
  }
  let targetDatabase;
  try {
    targetDatabase = decodeURIComponent(target.pathname.slice(1));
  } catch {
    throw new Error("CLASSROOM_DATABASE_URL database name is invalid");
  }
  if (
    target.hostname.toLowerCase() !== allowedHost.toLowerCase() ||
    targetDatabase !== databaseName
  ) {
    throw new Error("classroom database target mismatch");
  }
  if (!targetDatabase || targetDatabase.includes("/")) {
    throw new Error(
      "CLASSROOM_DATABASE_URL must identify exactly one database",
    );
  }
  return {
    databaseUrl,
    hostname: target.hostname,
    databaseName: targetDatabase,
  };
}

export async function bootstrapClassroom({ client, ledger, appSha }) {
  return runMigrationTransaction({
    client,
    ledger,
    appSha,
    async beforeApply(lockedClient) {
      const { rows } = await lockedClient.query(
        "SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = 'public') AS populated",
      );
      if (rows[0]?.populated) {
        throw new Error("classroom bootstrap requires an empty database");
      }
    },
  });
}

async function main() {
  const target = validateClassroomTarget({
    databaseUrl: process.env.CLASSROOM_DATABASE_URL,
    allowedHost: process.env.CLASSROOM_ALLOWED_HOST,
    databaseName: process.env.CLASSROOM_DATABASE_NAME,
  });
  const { ledger } = await verifySchemaAssets({ rootDir });
  const client = new Client({ connectionString: target.databaseUrl });
  try {
    await client.connect();
    const result = await bootstrapClassroom({
      client,
      ledger,
      appSha: process.env.CLASSROOM_APP_SHA,
    });
    console.log(JSON.stringify(result));
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    console.error(`classroom bootstrap rejected: ${error.message}`);
    process.exitCode = 1;
  });
}

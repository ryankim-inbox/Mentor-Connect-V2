import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  classroomConnection,
  fileChecksum,
  nativeCommand,
  snapshotEvidence,
} from "./classroom-snapshot.mjs";
import { verifySchemaAssets } from "../lib/db/tools/schema-assets.mjs";
import { diffCatalog, introspectCatalog } from "../lib/db/tools/catalog.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export async function restoreClassroom({
  databaseUrl,
  databaseName,
  dumpPath,
  allowedHost,
}) {
  const started = performance.now();
  if (!databaseUrl || !databaseName || !dumpPath)
    throw new Error(
      "restore URL, expected database and dump file are required",
    );
  let hostname;
  try {
    hostname = new URL(databaseUrl).hostname;
  } catch {
    throw new Error("invalid restore URL");
  }
  const connection = classroomConnection({
    databaseUrl,
    databaseName,
    allowedHost: allowedHost ?? hostname,
  });
  const manifest = JSON.parse(await readFile(`${dumpPath}.json`, "utf8"));
  if (
    manifest.formatVersion !== 1 ||
    !manifest.source?.hostname ||
    !manifest.source?.databaseName
  )
    throw new Error("invalid classroom backup manifest");
  if (
    manifest.source.hostname.toLowerCase() === hostname.toLowerCase() &&
    manifest.source.databaseName === databaseName
  ) {
    throw new Error(
      "restore requires a different source host/database combination",
    );
  }
  if (
    !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
    (await fileChecksum(dumpPath)) !== manifest.sha256
  )
    throw new Error("classroom dump checksum mismatch");
  const assets = await verifySchemaAssets({ rootDir });
  if (manifest.schemaVersion !== assets.version.schemaVersion)
    throw new Error("classroom backup schema version mismatch");
  const client = connection.createClient();
  try {
    await client.connect();
    // Serialize these wrappers; operators must keep the fresh target isolated from other writers.
    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      assets.ledger.advisoryLockKey,
    ]);
    const { rows } = await client.query(`SELECT EXISTS (
      SELECT 1 FROM pg_namespace WHERE nspname !~ '^pg_' AND nspname NOT IN ('public', 'information_schema')
      UNION ALL SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'public'
      UNION ALL SELECT 1 FROM pg_extension WHERE extname <> 'plpgsql'
    ) AS populated`);
    if (rows[0].populated)
      throw new Error("classroom restore requires an empty database");
    await nativeCommand(
      "pg_restore",
      [
        "--exit-on-error",
        "--single-transaction",
        "--no-owner",
        "--no-acl",
        "--dbname",
        databaseName,
        path.resolve(dumpPath),
      ],
      connection.env,
    );
    const catalog = await introspectCatalog(client);
    if (diffCatalog(assets.catalog, catalog).length)
      throw new Error("restored classroom catalog mismatch");
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const evidence = await snapshotEvidence(client, assets);
    await client.query("COMMIT");
    if (
      evidence.ledgerChecksum !== manifest.ledgerChecksum ||
      JSON.stringify(evidence.counts) !== JSON.stringify(manifest.counts)
    )
      throw new Error("restored classroom counts or ledger checksum mismatch");
    return {
      verified: true,
      ...evidence,
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    await client.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  restoreClassroom({
    databaseUrl: process.env.RESTORE_DATABASE_URL,
    databaseName: process.env.RESTORE_EXPECTED_DATABASE,
    dumpPath: process.argv[2],
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      const known = new Set([
        "restore URL, expected database and dump file are required",
        "invalid restore URL",
        "invalid classroom backup manifest",
        "classroom database target mismatch",
        "restore requires a different source host/database combination",
        "classroom dump checksum mismatch",
        "classroom backup schema version mismatch",
        "classroom restore requires an empty database",
        "restored classroom catalog mismatch",
        "restored classroom counts or ledger checksum mismatch",
      ]);
      console.error(
        known.has(error.message)
          ? `classroom restore rejected: ${error.message}`
          : "classroom restore rejected; check connection and native tool configuration",
      );
      process.exitCode = 1;
    });
}

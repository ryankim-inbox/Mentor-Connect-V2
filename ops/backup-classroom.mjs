import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, writeFile } from "node:fs/promises";
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

export async function backupClassroom({
  databaseUrl,
  allowedHost,
  databaseName,
  outputDir,
}) {
  if (!outputDir) throw new Error("BACKUP_OUTPUT_DIR is required");
  const connection = classroomConnection({
    databaseUrl,
    allowedHost,
    databaseName,
  });
  const catalogConnection = classroomConnection({
    databaseUrl,
    allowedHost,
    databaseName,
  });
  const assets = await verifySchemaAssets({ rootDir });
  await mkdir(outputDir, { recursive: true, mode: 0o700 });
  await chmod(outputDir, 0o700);
  const dumpPath = path.resolve(outputDir, `classroom-${randomUUID()}.dump`);
  const manifestPath = `${dumpPath}.json`;
  const reserved = await open(dumpPath, "wx", 0o600);
  await reserved.close();
  const client = connection.createClient();
  const catalogClient = catalogConnection.createClient();
  try {
    await client.connect();
    await catalogClient.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(
      `LOCK TABLE ${[...assets.catalog.tables, assets.ledger.ledgerTable].map((table) => `public."${table}"`).join(", ")} IN ACCESS SHARE MODE`,
    );
    const { rows } = await client.query(
      "SELECT pg_export_snapshot() AS snapshot, transaction_timestamp() AS captured_at",
    );
    // introspectCatalog owns a transaction: never give it the snapshot exporter.
    if (
      diffCatalog(assets.catalog, await introspectCatalog(catalogClient)).length
    ) {
      throw new Error(
        "classroom source catalog differs from the frozen schema",
      );
    }
    const evidence = await snapshotEvidence(client, assets);
    await nativeCommand(
      "pg_dump",
      [
        "--format=custom",
        "--no-owner",
        "--no-acl",
        "--snapshot",
        rows[0].snapshot,
        "--file",
        dumpPath,
      ],
      connection.env,
    );
    await client.query("COMMIT");
    const manifest = {
      formatVersion: 1,
      source: {
        hostname: connection.target.hostname.toLowerCase(),
        databaseName,
      },
      capturedAt: rows[0].captured_at.toISOString(),
      sha256: await fileChecksum(dumpPath),
      ...evidence,
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    return { dumpPath, manifestPath, ...manifest };
  } finally {
    await client.end();
    await catalogClient.end();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  backupClassroom({
    databaseUrl: process.env.CLASSROOM_DATABASE_URL,
    allowedHost: process.env.CLASSROOM_ALLOWED_HOST,
    databaseName: process.env.CLASSROOM_DATABASE_NAME,
    outputDir: process.env.BACKUP_OUTPUT_DIR,
  })
    .then((result) => console.log(JSON.stringify(result)))
    .catch(() => {
      console.error(
        "classroom backup rejected; verify target, schema, output directory and native tool configuration",
      );
      process.exitCode = 1;
    });
}

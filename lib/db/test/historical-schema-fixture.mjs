import { constants } from "node:fs";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { snapshotSchemaAssets } from "../../../ops/snapshot-schema.mjs";
import { verifySchemaAssets } from "../tools/schema-assets.mjs";

// Historical operators resolve assets from their code root. Isolate that root
// instead of widening production version guards or changing the current schema.
export async function historicalSchemaFixture(schemaVersion) {
  const source = path.resolve(import.meta.dirname, "../../..");
  const assets = await snapshotSchemaAssets({ rootDir: source, schemaVersion });
  const rootDir = await mkdtemp(path.join(tmpdir(), "mentor-historical-schema-"));
  const close = () => rm(rootDir, { recursive: true, force: true });
  try {
    for (const relative of ["ops", "database", "node_modules", "lib/db/tools", "lib/db/node_modules", "lib/db/package.json"]) {
      await cp(path.join(source, relative), path.join(rootDir, relative), {
        recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE,
      });
    }
    const ledger = JSON.parse(await readFile(path.join(source, "database/migrations/ledger.json"), "utf8"));
    ledger.migrations = ledger.migrations.slice(0, assets.ledger.migrations.length);
    await writeFile(path.join(rootDir, "database/migrations/ledger.json"), JSON.stringify(ledger, null, 2) + "\n");
    await writeFile(path.join(rootDir, "database/schema/canonical.sql"), assets.canonicalSql);
    await writeFile(path.join(rootDir, "database/schema/local-catalog.json"), JSON.stringify(assets.catalog, null, 2) + "\n");
    await writeFile(path.join(rootDir, "database/schema/version.json"), JSON.stringify(assets.version, null, 2) + "\n");
    await verifySchemaAssets({ rootDir });
    return { rootDir, assets, close, import: (relative) => import(pathToFileURL(path.join(rootDir, relative)).href) };
  } catch (error) {
    await close();
    throw error;
  }
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { verifySchemaAssets } from "../tools/schema-assets.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

test("current canonical schema is derived from the immutable ledger tail", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "mentor-connect-version-"));
  try {
    const migrationsDir = path.join(rootDir, "database/migrations");
    const schemaDir = path.join(rootDir, "database/schema");
    await mkdir(migrationsDir, { recursive: true });
    await mkdir(schemaDir, { recursive: true });

    const firstSql =
      "CREATE TABLE public.first_table (id INTEGER PRIMARY KEY);\n";
    const secondSql = "ALTER TABLE public.first_table ADD COLUMN name TEXT;\n";
    const canonicalSql = firstSql + secondSql;
    const catalogContents = `${JSON.stringify(
      {
        tables: ["first_table"],
        columns: [],
        constraints: [],
        indexes: [],
      },
      null,
      2,
    )}\n`;
    const versionManifest = {
      formatVersion: 1,
      schemaVersion: "0002",
      currentMigrationId: "0002_add_name",
      materialization: "ordered-migration-concatenation-v1",
      canonicalFile: "canonical.sql",
      canonicalSha256: sha256(canonicalSql),
      catalogFile: "local-catalog.json",
      catalogSha256: sha256(catalogContents),
      tableCount: 1,
      columnCount: 0,
      constraintCount: 0,
      indexCount: 0,
      stagingPreflightStatus: "[UNKNOWN]",
      stagingPlanStatus: "[UNKNOWN]",
      stagingP95Status: "[UNKNOWN]",
      stagingIndexLockTimeStatus: "[UNKNOWN]",
      productionStatus: "[UNKNOWN]",
      productionPlanStatus: "[UNKNOWN]",
      productionP95Status: "[UNKNOWN]",
      productionIndexLockTimeStatus: "[UNKNOWN]",
    };
    await Promise.all([
      writeFile(path.join(migrationsDir, "0001_first.sql"), firstSql),
      writeFile(path.join(migrationsDir, "0002_add_name.sql"), secondSql),
      writeFile(path.join(schemaDir, "canonical.sql"), canonicalSql),
      writeFile(path.join(schemaDir, "local-catalog.json"), catalogContents),
      writeFile(
        path.join(migrationsDir, "ledger.json"),
        `${JSON.stringify(
          {
            formatVersion: 1,
            advisoryLockKey: "774301992604150",
            ledgerTable: "mentor_connect_schema_migrations",
            migrations: [
              {
                id: "0001_first",
                path: "0001_first.sql",
                sha256: sha256(firstSql),
              },
              {
                id: "0002_add_name",
                path: "0002_add_name.sql",
                sha256: sha256(secondSql),
              },
            ],
          },
          null,
          2,
        )}\n`,
      ),
      writeFile(
        path.join(schemaDir, "version.json"),
        `${JSON.stringify(versionManifest, null, 2)}\n`,
      ),
    ]);

    const verified = await verifySchemaAssets({ rootDir });
    assert.equal(verified.version.schemaVersion, "0002");
    assert.equal(verified.ledger.migrations.length, 2);
    assert.equal(verified.canonicalSql, canonicalSql);

    await writeFile(
      path.join(schemaDir, "version.json"),
      `${JSON.stringify(
        {
          ...versionManifest,
          stagingPlanStatus: "verified-without-evidence",
        },
        null,
        2,
      )}\n`,
    );
    await assert.rejects(
      verifySchemaAssets({ rootDir }),
      /stagingPlanStatus must remain \[UNKNOWN\]/,
    );
    await writeFile(
      path.join(schemaDir, "version.json"),
      `${JSON.stringify(versionManifest, null, 2)}\n`,
    );

    await writeFile(path.join(schemaDir, "canonical.sql"), secondSql);
    await writeFile(
      path.join(schemaDir, "version.json"),
      `${JSON.stringify(
        {
          ...versionManifest,
          canonicalSha256: sha256(secondSql),
        },
        null,
        2,
      )}\n`,
    );
    await assert.rejects(
      verifySchemaAssets({ rootDir }),
      /canonical schema is not the deterministic materialization/,
    );
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

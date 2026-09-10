import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { verifyLegacyFixtures } from "../tools/legacy-fixture.mjs";

const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

test("legacy mock fixture is checksum-pinned and explicitly incompatible with schema 0002", async () => {
  const fixture = await verifyLegacyFixtures({
    rootDir,
    currentSchemaVersion: "0002",
  });
  assert.deepEqual(
    {
      id: fixture.id,
      schemaCompatibility: fixture.schemaCompatibility,
      currentSchemaCompatible: fixture.currentSchemaCompatible,
      destructiveLocalReset: fixture.destructiveLocalReset,
      deploymentUse: fixture.deploymentUse,
    },
    {
      id: "mentor-connect-mock-1000-v1",
      schemaCompatibility: "legacy-pre-0002",
      currentSchemaCompatible: false,
      destructiveLocalReset: true,
      deploymentUse: "forbidden",
    },
  );
});

test("legacy fixture manifest cannot claim current-schema compatibility", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "mentor-connect-legacy-fixture-"),
  );
  try {
    const fixtureDirectory = path.join(temporaryRoot, "database/fixtures");
    await mkdir(fixtureDirectory, { recursive: true });
    const sql = "SELECT 1;\n";
    await writeFile(
      path.join(temporaryRoot, "database/mentor_connect_mock_1000.sql"),
      sql,
    );
    await writeFile(
      path.join(fixtureDirectory, "legacy-fixtures.json"),
      `${JSON.stringify({
        formatVersion: 1,
        fixtures: [
          {
            id: "mentor-connect-mock-1000-v1",
            path: "../mentor_connect_mock_1000.sql",
            sha256: createHash("sha256").update(sql).digest("hex"),
            schemaCompatibility: "0002",
            currentSchemaCompatible: true,
            destructiveLocalReset: true,
            deploymentUse: "allowed",
          },
        ],
      })}\n`,
    );
    await assert.rejects(
      verifyLegacyFixtures({
        rootDir: temporaryRoot,
        currentSchemaVersion: "0002",
      }),
      /schemaCompatibility must be legacy-pre-0002|must not claim compatibility/,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

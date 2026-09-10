import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

function fail(message) {
  throw new Error(`legacy fixture manifest invalid: ${message}`);
}

export async function verifyLegacyFixtures({ rootDir, currentSchemaVersion }) {
  const manifestPath = path.join(
    rootDir,
    "database/fixtures/legacy-fixtures.json",
  );
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    fail(`cannot read manifest: ${error.message}`);
  }
  if (manifest.formatVersion !== 1) fail("formatVersion must be 1");
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length !== 1) {
    fail("exactly one explicitly versioned legacy fixture is required");
  }

  const fixture = manifest.fixtures[0];
  if (fixture.id !== "mentor-connect-mock-1000-v1") {
    fail("fixture id must be mentor-connect-mock-1000-v1");
  }
  if (fixture.schemaCompatibility !== "legacy-pre-0002") {
    fail("schemaCompatibility must be legacy-pre-0002");
  }
  if (
    fixture.currentSchemaCompatible !== false ||
    fixture.schemaCompatibility === currentSchemaVersion
  ) {
    fail(
      `fixture must not claim compatibility with current schema ${currentSchemaVersion}`,
    );
  }
  if (fixture.destructiveLocalReset !== true) {
    fail("destructiveLocalReset must be true");
  }
  if (fixture.deploymentUse !== "forbidden") {
    fail("deploymentUse must be forbidden");
  }
  if (!/^[a-f0-9]{64}$/.test(fixture.sha256 ?? "")) {
    fail("fixture sha256 is invalid");
  }

  const databaseRoot = path.join(rootDir, "database");
  const fixturePath = path.resolve(path.dirname(manifestPath), fixture.path);
  if (
    fixturePath !== databaseRoot &&
    !fixturePath.startsWith(`${databaseRoot}${path.sep}`)
  ) {
    fail("fixture path escapes database/");
  }
  const contents = await readFile(fixturePath, "utf8");
  const actualChecksum = createHash("sha256").update(contents).digest("hex");
  if (actualChecksum !== fixture.sha256) {
    fail("fixture checksum mismatch");
  }

  return { ...fixture, path: path.relative(rootDir, fixturePath) };
}

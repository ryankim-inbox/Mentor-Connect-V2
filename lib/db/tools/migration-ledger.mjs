import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const MIGRATION_ID = /^(\d{4,})_[a-z0-9_]+$/;
const SHA256 = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`migration ledger invalid: ${message}`);
}

export async function loadMigrationLedger({
  rootDir,
  manifestPath = "database/migrations/ledger.json",
} = {}) {
  if (!rootDir) fail("rootDir is required");
  const absoluteManifestPath = path.resolve(rootDir, manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(absoluteManifestPath, "utf8"));
  } catch (error) {
    fail(`cannot read ${manifestPath}: ${error.message}`);
  }

  if (manifest.formatVersion !== 1) fail("formatVersion must be 1");
  if (!/^-?\d+$/.test(manifest.advisoryLockKey ?? "")) {
    fail("advisoryLockKey must be a signed decimal bigint string");
  }
  if (manifest.ledgerTable !== "mentor_connect_schema_migrations") {
    fail("ledgerTable must be mentor_connect_schema_migrations");
  }
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length === 0) {
    fail("migrations must be a non-empty array");
  }

  const migrations = [];
  let previousSequence = -1;
  const seenIds = new Set();
  const seenPaths = new Set();
  const databaseRoot = path.resolve(rootDir, "database");

  for (const [index, entry] of manifest.migrations.entries()) {
    const match = MIGRATION_ID.exec(entry.id ?? "");
    if (!match) fail(`migration ${index + 1} has an invalid id`);
    const sequence = Number(match[1]);
    if (!Number.isSafeInteger(sequence) || sequence <= previousSequence) {
      fail(`migration identifiers must be strictly increasing at ${entry.id}`);
    }
    if (seenIds.has(entry.id)) fail(`duplicate migration id ${entry.id}`);
    if (typeof entry.path !== "string" || entry.path.length === 0) {
      fail(`migration ${entry.id} must have a path`);
    }
    const absolutePath = path.resolve(
      path.dirname(absoluteManifestPath),
      entry.path,
    );
    if (
      absolutePath !== databaseRoot &&
      !absolutePath.startsWith(`${databaseRoot}${path.sep}`)
    ) {
      fail(`migration ${entry.id} path escapes database/`);
    }
    if (seenPaths.has(absolutePath))
      fail(`duplicate migration path ${entry.path}`);
    if (!SHA256.test(entry.sha256 ?? ""))
      fail(`migration ${entry.id} has an invalid sha256`);

    let sql;
    try {
      sql = await readFile(absolutePath, "utf8");
    } catch (error) {
      fail(`cannot read migration ${entry.id}: ${error.message}`);
    }
    const actualChecksum = createHash("sha256").update(sql).digest("hex");
    if (actualChecksum !== entry.sha256) {
      fail(
        `checksum mismatch for ${entry.id}: expected ${entry.sha256}, got ${actualChecksum}`,
      );
    }

    migrations.push({
      ordinal: index + 1,
      sequence,
      id: entry.id,
      path: path.relative(rootDir, absolutePath),
      sha256: entry.sha256,
      sql,
    });
    previousSequence = sequence;
    seenIds.add(entry.id);
    seenPaths.add(absolutePath);
  }

  return {
    advisoryLockKey: manifest.advisoryLockKey,
    ledgerTable: manifest.ledgerTable,
    migrations,
  };
}

export function validateAppliedMigrations(migrations, appliedRows) {
  if (!Array.isArray(appliedRows)) fail("applied history must be an array");
  if (appliedRows.length > migrations.length) {
    fail(
      "applied history contains migrations absent from the repository ledger",
    );
  }

  for (let index = 0; index < appliedRows.length; index += 1) {
    const expected = migrations[index];
    const actual = appliedRows[index];
    if (
      actual.ordinal !== expected.ordinal ||
      actual.migrationId !== expected.id
    ) {
      fail(`applied history is out of order at ordinal ${index + 1}`);
    }
    if (actual.checksum !== expected.sha256) {
      fail(`applied checksum mismatch for ${expected.id}`);
    }
  }

  return migrations.slice(appliedRows.length);
}

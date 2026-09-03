import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { loadMigrationLedger } from "./migration-ledger.mjs";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

export async function verifySchemaAssets({ rootDir }) {
  const schemaDirectory = path.join(rootDir, "database/schema");
  const version = JSON.parse(
    await readFile(path.join(schemaDirectory, "version.json"), "utf8"),
  );
  if (
    version.formatVersion !== 1 ||
    !/^\d{4,}$/.test(version.schemaVersion ?? "")
  ) {
    throw new Error("schema version manifest is invalid");
  }
  if (version.materialization !== "ordered-migration-concatenation-v1") {
    throw new Error("schema materialization contract is invalid");
  }
  if (path.basename(version.canonicalFile ?? "") !== version.canonicalFile) {
    throw new Error("canonicalFile must be a file in database/schema");
  }
  if (path.basename(version.catalogFile ?? "") !== version.catalogFile) {
    throw new Error("catalogFile must be a file in database/schema");
  }

  const [canonicalSql, catalogContents, ledger] = await Promise.all([
    readFile(path.join(schemaDirectory, version.canonicalFile), "utf8"),
    readFile(path.join(schemaDirectory, version.catalogFile), "utf8"),
    loadMigrationLedger({ rootDir }),
  ]);
  if (sha256(canonicalSql) !== version.canonicalSha256) {
    throw new Error("canonical schema checksum mismatch");
  }
  if (sha256(catalogContents) !== version.catalogSha256) {
    throw new Error("frozen catalog checksum mismatch");
  }

  const currentMigration = ledger.migrations.at(-1);
  const expectedVersion = currentMigration.sequence
    .toString()
    .padStart(version.schemaVersion.length, "0");
  if (
    version.schemaVersion !== expectedVersion ||
    version.currentMigrationId !== currentMigration.id
  ) {
    throw new Error(
      "schema version and currentMigrationId must identify the migration ledger tail",
    );
  }
  const materializedSql = ledger.migrations
    .map((migration) => migration.sql)
    .join("");
  if (canonicalSql !== materializedSql) {
    throw new Error(
      "canonical schema is not the deterministic materialization of the ordered migration ledger",
    );
  }

  const catalog = JSON.parse(catalogContents);
  for (const [field, actual] of [
    ["tableCount", catalog.tables?.length],
    ["columnCount", catalog.columns?.length],
    ["constraintCount", catalog.constraints?.length],
    ["indexCount", catalog.indexes?.length],
  ]) {
    if (version[field] !== actual) {
      throw new Error(`${field} does not match the frozen catalog`);
    }
  }
  for (const field of [
    "stagingPreflightStatus",
    "stagingPlanStatus",
    "stagingP95Status",
    "stagingIndexLockTimeStatus",
    "productionStatus",
    "productionPlanStatus",
    "productionP95Status",
    "productionIndexLockTimeStatus",
  ]) {
    if (version[field] !== "[UNKNOWN]") {
      throw new Error(
        `${field} must remain [UNKNOWN] until environment-specific evidence exists`,
      );
    }
  }

  return { version, catalog, canonicalSql, ledger };
}

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";

import { diffCatalog, introspectCatalog } from "../tools/catalog.mjs";
import { loadMigrationLedger } from "../tools/migration-ledger.mjs";
import { runMigrationTransaction } from "../tools/migration-runner.mjs";

const { Client } = pg;
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const execFile = promisify(execFileCallback);
const cliPath = path.join(rootDir, "lib/db/tools/schema-cli.mjs");

async function resetPublicSchema(client) {
  await client.query("DROP SCHEMA public CASCADE");
  await client.query("CREATE SCHEMA public");
}

test("canonical schema reproduces the frozen 13-table local catalog", async () => {
  assert.match(
    process.env.TEST_DATABASE_URL ?? "",
    /^postgresql:\/\/127\.0\.0\.1:/,
  );
  const canonicalPath = path.join(rootDir, "database/schema/canonical.sql");
  const catalogPath = path.join(rootDir, "database/schema/local-catalog.json");
  const versionPath = path.join(rootDir, "database/schema/version.json");
  const [canonicalSql, catalogJson, versionJson] = await Promise.all([
    readFile(canonicalPath, "utf8"),
    readFile(catalogPath, "utf8"),
    readFile(versionPath, "utf8"),
  ]);
  const expectedCatalog = JSON.parse(catalogJson);
  const version = JSON.parse(versionJson);
  const checksum = createHash("sha256").update(canonicalSql).digest("hex");

  assert.equal(version.schemaVersion, "0001");
  assert.equal(version.tableCount, 13);
  assert.equal(version.canonicalSha256, checksum);

  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await client.connect();
  try {
    await resetPublicSchema(client);
    await client.query(canonicalSql);
    const actualCatalog = await introspectCatalog(client);
    assert.equal(actualCatalog.tables.length, 13);
    assert.deepEqual(diffCatalog(expectedCatalog, actualCatalog), []);

    const cliEnvironment = {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    };
    const diffResult = await execFile(
      process.execPath,
      [cliPath, "schema:diff", "--read-only"],
      {
        cwd: rootDir,
        env: cliEnvironment,
      },
    );
    assert.match(diffResult.stdout, /schema diff: 0 \(read-only\)/);
    const statusResult = await execFile(
      process.execPath,
      [cliPath, "migration:status"],
      {
        cwd: rootDir,
        env: cliEnvironment,
      },
    );
    assert.match(statusResult.stdout, /applied: 0/);
    assert.match(statusResult.stdout, /pending: 1 \(0001_canonical_baseline\)/);
  } finally {
    await client.end();
  }
});

test("runner waits for its advisory lock and records immutable application metadata", async () => {
  const lockHolder = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  const runnerClient = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await lockHolder.connect();
  await runnerClient.connect();
  const ledger = await loadMigrationLedger({ rootDir });
  try {
    await resetPublicSchema(lockHolder);
    await lockHolder.query("DROP SCHEMA IF EXISTS shadow CASCADE");
    await lockHolder.query("CREATE SCHEMA shadow");
    await runnerClient.query("SET search_path TO shadow, public");
    await lockHolder.query("BEGIN");
    await lockHolder.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      ledger.advisoryLockKey,
    ]);

    const runPromise = runMigrationTransaction({
      client: runnerClient,
      ledger,
      appSha: "a".repeat(40),
    });
    const stateWhileHeld = await Promise.race([
      runPromise.then(() => "completed"),
      new Promise((resolve) => setTimeout(() => resolve("waiting"), 100)),
    ]);
    assert.equal(stateWhileHeld, "waiting");

    await lockHolder.query("COMMIT");
    const result = await runPromise;
    assert.deepEqual(result, {
      applied: ["0001_canonical_baseline"],
      alreadyApplied: [],
    });

    const persisted = await runnerClient.query(`
      SELECT ordinal, migration_id AS "migrationId", checksum, applied_at AS "appliedAt", app_sha AS "appSha"
      FROM mentor_connect_schema_migrations
      ORDER BY ordinal
    `);
    assert.equal(persisted.rows.length, 1);
    assert.equal(persisted.rows[0].ordinal, 1);
    assert.equal(persisted.rows[0].migrationId, "0001_canonical_baseline");
    assert.equal(persisted.rows[0].checksum, ledger.migrations[0].sha256);
    assert.ok(persisted.rows[0].appliedAt instanceof Date);
    assert.equal(persisted.rows[0].appSha, "a".repeat(40));

    const resolvedSchemas = await runnerClient.query(`
      SELECT
        to_regclass('public.users')::text AS "publicUsers",
        to_regclass('shadow.users')::text AS "shadowUsers",
        current_setting('search_path') AS "ambientSearchPath"
    `);
    assert.deepEqual(resolvedSchemas.rows[0], {
      publicUsers: "users",
      shadowUsers: null,
      ambientSearchPath: "shadow, public",
    });

    await runnerClient.query(
      "UPDATE mentor_connect_schema_migrations SET checksum = $1 WHERE ordinal = 1",
      ["f".repeat(64)],
    );
    await assert.rejects(
      runMigrationTransaction({
        client: runnerClient,
        ledger,
        appSha: "b".repeat(40),
      }),
      /applied checksum mismatch/,
    );
  } finally {
    await lockHolder.query("ROLLBACK").catch(() => {});
    await Promise.all([lockHolder.end(), runnerClient.end()]);
  }
});

test("runner rolls back schema and ledger writes when a migration fails", async () => {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await client.connect();
  try {
    await resetPublicSchema(client);
    const createSql = "CREATE TABLE rollback_probe (id INTEGER PRIMARY KEY);";
    const failingSql = "SELECT * FROM table_that_does_not_exist;";
    const ledger = {
      advisoryLockKey: "774301992604150",
      ledgerTable: "mentor_connect_schema_migrations",
      migrations: [
        {
          ordinal: 1,
          sequence: 1,
          id: "0001_create_probe",
          sha256: createHash("sha256").update(createSql).digest("hex"),
          sql: createSql,
        },
        {
          ordinal: 2,
          sequence: 2,
          id: "0002_fail_probe",
          sha256: createHash("sha256").update(failingSql).digest("hex"),
          sql: failingSql,
        },
      ],
    };

    await assert.rejects(
      runMigrationTransaction({ client, ledger, appSha: "c".repeat(40) }),
      /table_that_does_not_exist/,
    );
    const relations = await client.query(`
      SELECT
        to_regclass('public.rollback_probe') AS probe,
        to_regclass('public.mentor_connect_schema_migrations') AS ledger
    `);
    assert.deepEqual(relations.rows[0], { probe: null, ledger: null });
  } finally {
    await client.end();
  }
});

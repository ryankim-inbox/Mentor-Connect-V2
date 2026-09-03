import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { diffCatalog } from "../tools/catalog.mjs";
import {
  loadMigrationLedger,
  validateAppliedMigrations,
} from "../tools/migration-ledger.mjs";
import { runMigrationTransaction } from "../tools/migration-runner.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const execFile = promisify(execFileCallback);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const cliPath = path.join(rootDir, "lib/db/tools/schema-cli.mjs");

async function withLedger(entries, files, run) {
  const root = await mkdtemp(path.join(tmpdir(), "mentor-connect-ledger-"));
  try {
    await mkdir(path.join(root, "database", "migrations"), { recursive: true });
    await mkdir(path.join(root, "database", "schema"), { recursive: true });
    for (const [relativePath, contents] of Object.entries(files)) {
      await writeFile(path.join(root, relativePath), contents);
    }
    await writeFile(
      path.join(root, "database", "migrations", "ledger.json"),
      `${JSON.stringify(
        {
          formatVersion: 1,
          advisoryLockKey: "774301992604150",
          ledgerTable: "mentor_connect_schema_migrations",
          migrations: entries,
        },
        null,
        2,
      )}\n`,
    );
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("ledger rejects migration identifiers that are not strictly increasing", async () => {
  const firstSql = "SELECT 1;\n";
  const secondSql = "SELECT 2;\n";
  await withLedger(
    [
      { id: "0002_second", path: "0002_second.sql", sha256: sha256(firstSql) },
      { id: "0001_first", path: "0001_first.sql", sha256: sha256(secondSql) },
    ],
    {
      "database/migrations/0002_second.sql": firstSql,
      "database/migrations/0001_first.sql": secondSql,
    },
    async (root) => {
      await assert.rejects(
        loadMigrationLedger({ rootDir: root }),
        /strictly increasing/,
      );
    },
  );
});

test("ledger rejects a migration whose immutable checksum changed", async () => {
  const sql = "SELECT 1;\n";
  await withLedger(
    [{ id: "0001_first", path: "0001_first.sql", sha256: "0".repeat(64) }],
    { "database/migrations/0001_first.sql": sql },
    async (root) => {
      await assert.rejects(
        loadMigrationLedger({ rootDir: root }),
        /checksum mismatch/,
      );
    },
  );
});

test("applied history must be an exact immutable prefix of the repository ledger", async () => {
  const migrations = [
    { ordinal: 1, id: "0001_first", sha256: "a".repeat(64) },
    { ordinal: 2, id: "0002_second", sha256: "b".repeat(64) },
  ];

  assert.throws(
    () =>
      validateAppliedMigrations(migrations, [
        { ordinal: 1, migrationId: "0001_first", checksum: "c".repeat(64) },
      ]),
    /checksum mismatch/,
  );
  assert.throws(
    () =>
      validateAppliedMigrations(migrations, [
        { ordinal: 2, migrationId: "0002_second", checksum: "b".repeat(64) },
      ]),
    /out of order/,
  );
  assert.deepEqual(
    validateAppliedMigrations(migrations, [
      { ordinal: 1, migrationId: "0001_first", checksum: "a".repeat(64) },
    ]),
    [migrations[1]],
  );
});

test("runner rejects a reordered or altered runtime ledger before opening a transaction", async () => {
  const client = {
    query() {
      throw new Error(
        "database must not be touched for an invalid runtime ledger",
      );
    },
  };
  const baseLedger = {
    advisoryLockKey: "774301992604150",
    ledgerTable: "mentor_connect_schema_migrations",
  };
  const firstSql = "SELECT 1;\n";
  const secondSql = "SELECT 2;\n";

  await assert.rejects(
    runMigrationTransaction({
      client,
      appSha: "a".repeat(40),
      ledger: {
        ...baseLedger,
        migrations: [
          {
            ordinal: 1,
            sequence: 2,
            id: "0002_second",
            sha256: sha256(secondSql),
            sql: secondSql,
          },
          {
            ordinal: 2,
            sequence: 1,
            id: "0001_first",
            sha256: sha256(firstSql),
            sql: firstSql,
          },
        ],
      },
    }),
    /strictly increasing/,
  );
  await assert.rejects(
    runMigrationTransaction({
      client,
      appSha: "a".repeat(40),
      ledger: {
        ...baseLedger,
        migrations: [
          {
            ordinal: 1,
            sequence: 1,
            id: "0001_first",
            sha256: "f".repeat(64),
            sql: firstSql,
          },
        ],
      },
    }),
    /checksum mismatch/,
  );
});

test("catalog diff reports missing, unexpected, and changed catalog objects", () => {
  const expected = {
    tables: ["districts", "users"],
    columns: [
      {
        table: "districts",
        position: 1,
        name: "id",
        type: "integer",
        nullable: false,
        default: "sequence",
      },
      {
        table: "users",
        position: 1,
        name: "id",
        type: "integer",
        nullable: false,
        default: "sequence",
      },
    ],
    constraints: [
      {
        table: "users",
        name: "users_pkey",
        type: "p",
        definition: "PRIMARY KEY (id)",
      },
    ],
    indexes: [],
  };
  const actual = {
    tables: ["districts", "requests"],
    columns: [
      {
        table: "districts",
        position: 1,
        name: "id",
        type: "bigint",
        nullable: false,
        default: "sequence",
      },
      {
        table: "requests",
        position: 1,
        name: "id",
        type: "integer",
        nullable: false,
        default: "sequence",
      },
    ],
    constraints: [],
    indexes: [
      {
        table: "requests",
        name: "requests_pkey",
        definition: "CREATE UNIQUE INDEX requests_pkey",
      },
    ],
  };

  assert.deepEqual(diffCatalog(expected, actual), [
    'columns changed districts.id: expected {"default":"sequence","name":"id","nullable":false,"position":1,"table":"districts","type":"integer"}, actual {"default":"sequence","name":"id","nullable":false,"position":1,"table":"districts","type":"bigint"}',
    "columns missing users.id",
    "columns unexpected requests.id",
    "constraints missing users.users_pkey",
    "indexes unexpected requests.requests_pkey",
    "tables missing users",
    "tables unexpected requests",
  ]);
});

test("schema check validates the canonical version and immutable ledger", async () => {
  const result = await execFile(process.execPath, [cliPath, "schema:check"], {
    cwd: rootDir,
    env: { ...process.env, DATABASE_URL: "" },
  });
  assert.match(
    result.stdout,
    /schema check: ok \(version 0002, 13 tables, 2 migration\)/,
  );
});

test("database inspection commands fail closed without their read-only contract", async () => {
  await assert.rejects(
    execFile(process.execPath, [cliPath, "schema:diff"], {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: "postgresql://127.0.0.1:1/unused" },
    }),
    (error) => error.code === 1 && /--read-only is required/.test(error.stderr),
  );
  await assert.rejects(
    execFile(process.execPath, [cliPath, "schema:diff", "--read-only"], {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: "" },
    }),
    (error) =>
      error.code === 1 && /DATABASE_URL is required/.test(error.stderr),
  );
  await assert.rejects(
    execFile(process.execPath, [cliPath, "schema:diff", "--", "--read-only"], {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: "" },
    }),
    (error) =>
      error.code === 1 && /DATABASE_URL is required/.test(error.stderr),
  );
  await assert.rejects(
    execFile(process.execPath, [cliPath, "migration:status"], {
      cwd: rootDir,
      env: { ...process.env, DATABASE_URL: "" },
    }),
    (error) =>
      error.code === 1 && /DATABASE_URL is required/.test(error.stderr),
  );
});

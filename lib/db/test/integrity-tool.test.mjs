import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import {
  parseEnvironmentArguments,
  validateDatabaseTarget,
} from "../tools/environment.mjs";
import { collectPlanIndexes } from "../tools/integrity.mjs";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const cliPath = path.join(rootDir, "lib/db/tools/schema-cli.mjs");

test("environment arguments accept one explicit scoped environment", () => {
  assert.deepEqual(parseEnvironmentArguments(["--", "--env", "local"]), {
    environment: "local",
    dryRun: false,
  });
  assert.deepEqual(
    parseEnvironmentArguments(["--env", "staging", "--dry-run"], {
      requireDryRun: true,
    }),
    { environment: "staging", dryRun: true },
  );

  assert.throws(
    () => parseEnvironmentArguments(["--env", "qa"]),
    /--env must be local, staging, or production/,
  );
  assert.throws(
    () =>
      parseEnvironmentArguments(["--env", "staging"], {
        requireDryRun: true,
      }),
    /only supports --dry-run/,
  );
  assert.throws(
    () => parseEnvironmentArguments(["--env", "local", "--write"]),
    /unsupported argument: --write/,
  );
});

test("database target validation prevents cross-environment inspection", () => {
  assert.equal(
    validateDatabaseTarget({
      environment: "local",
      databaseUrl: "postgresql://127.0.0.1:5432/mentor_connect",
      processEnvironment: {},
    }).hostname,
    "127.0.0.1",
  );
  assert.equal(
    validateDatabaseTarget({
      environment: "local",
      databaseUrl: "postgresql://[::1]:5432/mentor_connect",
      processEnvironment: {},
    }).hostname,
    "::1",
  );
  assert.throws(
    () =>
      validateDatabaseTarget({
        environment: "local",
        databaseUrl: "postgresql://staging-db.internal/mentor_connect",
        processEnvironment: {},
      }),
    /local inspection requires a loopback database host/,
  );
  assert.equal(
    validateDatabaseTarget({
      environment: "staging",
      databaseUrl: "postgresql://staging-db.internal/mentor_connect",
      processEnvironment: {
        MIGRATION_ALLOWED_HOSTS_STAGING: "staging-db.internal",
      },
    }).hostname,
    "staging-db.internal",
  );
  assert.throws(
    () =>
      validateDatabaseTarget({
        environment: "staging",
        databaseUrl: "postgresql://production-db.internal/mentor_connect",
        processEnvironment: {
          MIGRATION_ALLOWED_HOSTS_STAGING: "staging-db.internal",
        },
      }),
    /not allowlisted for environment staging/,
  );
});

test("EXPLAIN index collection walks nested PostgreSQL JSON plans", () => {
  const plan = {
    Plan: {
      "Node Type": "Nested Loop",
      Plans: [
        {
          "Node Type": "Bitmap Heap Scan",
          Plans: [
            {
              "Node Type": "Bitmap Index Scan",
              "Index Name": "idx_request_tags_tag",
            },
          ],
        },
        {
          "Node Type": "Index Only Scan",
          "Index Name": "users_pkey",
        },
      ],
    },
  };

  assert.deepEqual(collectPlanIndexes(plan), [
    "idx_request_tags_tag",
    "users_pkey",
  ]);
});

test("constraint verification owns an explicit read-only transaction", async () => {
  const { verifyConstraintCatalog } = await import("../tools/integrity.mjs");
  const queries = [];
  const client = {
    async query(sql) {
      const normalized = sql.trim().replaceAll(/\s+/g, " ");
      queries.push(normalized);
      if (normalized === "SHOW transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] };
      }
      return { rows: [] };
    },
  };

  const result = await verifyConstraintCatalog(client, []);

  assert.deepEqual(result, { readOnly: true, differences: [] });
  assert.equal(queries[0], "BEGIN TRANSACTION READ ONLY");
  assert.equal(queries[1], "SET LOCAL search_path TO public, pg_catalog");
  assert.equal(queries[2], "SHOW transaction_read_only");
  assert.match(queries[3], /FROM pg_catalog\.pg_constraint/);
  assert.equal(queries.at(-1), "COMMIT");
});

test("constraint verification asserts read-only mode and rolls back every failure", async () => {
  const { verifyConstraintCatalog } = await import("../tools/integrity.mjs");
  for (const failure of ["read-write-mode", "catalog-error"]) {
    const queries = [];
    const client = {
      async query(sql) {
        const normalized = sql.trim().replaceAll(/\s+/g, " ");
        queries.push(normalized);
        if (normalized === "SHOW transaction_read_only") {
          return {
            rows: [
              {
                transaction_read_only:
                  failure === "read-write-mode" ? "off" : "on",
              },
            ],
          };
        }
        if (
          failure === "catalog-error" &&
          normalized.includes("FROM pg_catalog.pg_constraint")
        ) {
          throw new Error("catalog unavailable");
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      verifyConstraintCatalog(client, []),
      failure === "read-write-mode"
        ? /integrity inspection requires a read-only transaction/
        : /catalog unavailable/,
    );
    assert.equal(queries.at(-1), "ROLLBACK");
    assert.ok(!queries.includes("COMMIT"));
  }
});

test("migration apply surface rejects real apply and completes without database access", async () => {
  await assert.rejects(
    execFile(
      process.execPath,
      [cliPath, "migration:apply", "--env", "staging"],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          DATABASE_URL:
            "postgresql://migration-user:secret@staging-db.invalid/mentor_connect",
          MIGRATION_ALLOWED_HOSTS_STAGING: "staging-db.invalid",
        },
      },
    ),
    /migration:apply only supports --dry-run until Slice 11/,
  );

  const result = await execFile(
    process.execPath,
    [cliPath, "migration:apply", "--env", "staging", "--dry-run"],
    {
      cwd: rootDir,
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://migration-user:secret@staging-db.invalid/mentor_connect",
        MIGRATION_ALLOWED_HOSTS_STAGING: "staging-db.invalid",
      },
    },
  );
  assert.match(
    result.stdout,
    /migration apply: dry-run only; schema 0002; target staging; no database connection or changes/,
  );
  assert.doesNotMatch(result.stdout, /secret/);
});

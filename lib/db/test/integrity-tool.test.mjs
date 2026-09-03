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

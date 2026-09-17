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
import {
  collectPlanIndexes,
  runIntegrityPreflight,
} from "../tools/integrity.mjs";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const cliPath = path.join(rootDir, "lib/db/tools/schema-cli.mjs");

test("environment arguments accept one explicit scoped environment", () => {
  assert.deepEqual(parseEnvironmentArguments(["--", "--env", "local"]), {
    environment: "local",
  });

  assert.throws(
    () => parseEnvironmentArguments(["--env", "qa"]),
    /--env must be local, staging, or production/,
  );
  assert.throws(
    () => parseEnvironmentArguments(["--env", "staging", "--dry-run"]),
    /unsupported argument: --dry-run/,
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

test("integrity preflight sets local timeouts and counts before requesting evidence", async () => {
  const queries = [];
  const client = {
    async query(sql, parameters) {
      const normalized = sql.trim().replaceAll(/\s+/g, " ");
      queries.push({ sql: normalized, parameters });
      if (normalized === "SHOW transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] };
      }
      if (normalized.startsWith("SELECT count(*)::text")) {
        return { rows: [{ violationCount: "0" }] };
      }
      return { rows: [] };
    },
  };

  const result = await runIntegrityPreflight(client);

  assert.equal(result.violationCount, "0");
  assert.ok(result.checks.length > 20);
  assert.ok(result.checks.every((check) => !("candidates" in check)));
  assert.equal(
    queries[0].sql,
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  assert.equal(queries[1].sql, "SET LOCAL search_path TO public, pg_catalog");
  assert.equal(queries[2].sql, "SET LOCAL statement_timeout = '15s'");
  assert.equal(queries[3].sql, "SET LOCAL lock_timeout = '2s'");
  assert.equal(
    queries[4].sql,
    "SET LOCAL idle_in_transaction_session_timeout = '15s'",
  );
  const inspectionQueries = queries.slice(6, -1);
  assert.ok(inspectionQueries.length > 20);
  assert.ok(
    inspectionQueries.every(
      ({ sql, parameters }) =>
        sql.startsWith("SELECT count(*)::text") && parameters === undefined,
    ),
  );
  assert.equal(queries.at(-1).sql, "COMMIT");
});

test("integrity preflight paginates candidate evidence under a hard total cap", async () => {
  let countQueries = 0;
  const detailQueries = [];
  const evidencePages = [];
  const client = {
    async query(sql, parameters) {
      const normalized = sql.trim().replaceAll(/\s+/g, " ");
      if (normalized === "SHOW transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] };
      }
      if (normalized.startsWith("SELECT count(*)::text")) {
        countQueries += 1;
        return {
          rows: [{ violationCount: countQueries === 1 ? "2500" : "0" }],
        };
      }
      if (normalized.includes("LIMIT $1 OFFSET $2")) {
        detailQueries.push({ sql: normalized, parameters });
        const [limit, offset] = parameters;
        return {
          rows: Array.from({ length: limit }, (_, index) => ({
            candidate: {
              blockerId: offset + index + 1,
              blockedUserId: offset + index + 2,
            },
          })),
        };
      }
      return { rows: [] };
    },
  };

  const result = await runIntegrityPreflight(client, {
    candidateLimit: 250,
    pageSize: 100,
    async writeEvidencePage(page) {
      evidencePages.push(page);
    },
  });

  assert.equal(result.violationCount, "2500");
  assert.deepEqual(
    evidencePages.map((page) => page.candidates.length),
    [100, 100, 50],
  );
  assert.ok(
    evidencePages.every((page) => page.checkId === "duplicate_block_pair"),
  );
  assert.deepEqual(
    detailQueries.map((query) => query.parameters),
    [
      [100, 0],
      [100, 100],
      [50, 200],
    ],
  );
  assert.deepEqual(result.evidence, {
    protectedSink: true,
    candidateLimit: 250,
    candidatesWritten: 250,
    truncated: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /blockerId|blockedUserId/);
});

test("integrity preflight refuses violations without a protected evidence writer", async () => {
  let countQueries = 0;
  const client = {
    async query(sql) {
      const normalized = sql.trim().replaceAll(/\s+/g, " ");
      if (normalized === "SHOW transaction_read_only") {
        return { rows: [{ transaction_read_only: "on" }] };
      }
      if (normalized.startsWith("SELECT count(*)::text")) {
        countQueries += 1;
        return { rows: [{ violationCount: countQueries === 1 ? "1" : "0" }] };
      }
      return { rows: [] };
    },
  };

  await assert.rejects(
    runIntegrityPreflight(client),
    /protected evidence writer is required when violations exist/,
  );
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
  assert.equal(
    queries[0],
    "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
  );
  assert.equal(queries[1], "SET LOCAL search_path TO public, pg_catalog");
  assert.equal(queries[2], "SET LOCAL statement_timeout = '15s'");
  assert.equal(queries[3], "SET LOCAL lock_timeout = '2s'");
  assert.equal(
    queries[4],
    "SET LOCAL idle_in_transaction_session_timeout = '15s'",
  );
  assert.equal(queries[5], "SHOW transaction_read_only");
  assert.match(queries[6], /FROM pg_catalog\.pg_constraint/);
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

test("schema CLI exposes no migration apply command, including dry-run", async () => {
  const testDatabaseUrl = new URL(
    "postgresql://staging-db.invalid/classroom",
  );
  testDatabaseUrl.username = "fixture-user";
  testDatabaseUrl.password = "fixture-canary";

  for (const args of [
    ["migration:apply", "--env", "staging"],
    ["migration:apply", "--env", "staging", "--dry-run"],
  ]) {
    await assert.rejects(
      execFile(process.execPath, [cliPath, ...args], {
        cwd: rootDir,
        env: {
          ...process.env,
          DATABASE_URL: testDatabaseUrl.href,
          MIGRATION_ALLOWED_HOSTS_STAGING: "staging-db.invalid",
        },
      }),
      (error) => {
        const output = `${error.stdout}${error.stderr}`;
        return (
          error.code === 1 &&
          /unsupported schema tool command/.test(error.stderr) &&
          !output.includes(testDatabaseUrl.password) &&
          !output.includes(testDatabaseUrl.href)
        );
      },
    );
  }
});

test("migration preflight requires a protected inherited evidence descriptor before connecting", async () => {
  const testDatabaseUrl = new URL(
    "postgresql://staging-db.invalid/classroom",
  );
  testDatabaseUrl.username = "fixture-user";
  testDatabaseUrl.password = "fixture-canary";

  await assert.rejects(
    execFile(
      process.execPath,
      [cliPath, "migration:preflight", "--env", "staging"],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          DATABASE_URL: testDatabaseUrl.href,
          MIGRATION_ALLOWED_HOSTS_STAGING: "staging-db.invalid",
        },
      },
    ),
    (error) => {
      const output = `${error.stdout}${error.stderr}`;
      return (
        error.code === 1 &&
        /PREFLIGHT_EVIDENCE_FD is required/.test(error.stderr) &&
        !output.includes(testDatabaseUrl.password) &&
        !output.includes(testDatabaseUrl.href)
      );
    },
  );
});

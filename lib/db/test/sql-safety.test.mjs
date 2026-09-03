import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { assertMigrationSqlIsAtomic } from "../tools/sql-safety.mjs";
import { runMigrationTransaction } from "../tools/migration-runner.mjs";

test("SQL-aware scanner ignores transaction words in non-executable lexical regions", () => {
  const sql = String.raw`
    -- COMMIT; ROLLBACK; BEGIN;
    /* outer START TRANSACTION; /* nested ABORT; */ SAVEPOINT hidden; */
    SELECT 'COMMIT; ROLLBACK ''still a string''';
    SELECT E'BEGIN; escaped quote: \' END;';
    SELECT U&'ROLLBACK \\0061';
    SELECT "COMMIT", U&"ROLLBACK\\0061" FROM (VALUES (1)) AS "BEGIN"("END");
    DO $body$
    BEGIN
      RAISE NOTICE 'COMMIT; ROLLBACK';
    END
    $body$;
    SELECT '$tag$ START TRANSACTION $tag$';
  `;

  assert.doesNotThrow(() => assertMigrationSqlIsAtomic(sql));
});

test("SQL-aware scanner rejects transaction-boundary statements", () => {
  const forbidden = [
    "BEGIN;",
    "START TRANSACTION;",
    "COMMIT;",
    "END WORK;",
    "ROLLBACK;",
    "ABORT;",
    "SAVEPOINT before_change;",
    "RELEASE SAVEPOINT before_change;",
    "PREPARE TRANSACTION 'external-commit';",
    "SELECT 1; /* harmless */ ROLLBACK TO SAVEPOINT before_change;",
    "-- leading comment\nCOMMIT AND CHAIN;",
  ];

  for (const sql of forbidden) {
    assert.throws(
      () => assertMigrationSqlIsAtomic(sql),
      /transaction-control statement is forbidden/,
      sql,
    );
  }
});

test("line comments end at every PostgreSQL newline form", () => {
  for (const newline of ["\n", "\r", "\r\n"]) {
    assert.doesNotThrow(
      () => assertMigrationSqlIsAtomic(`-- COMMIT hidden${newline}SELECT 1;`),
      JSON.stringify(newline),
    );
    assert.throws(
      () => assertMigrationSqlIsAtomic(`-- harmless${newline}COMMIT;`),
      /transaction-control statement is forbidden: COMMIT/,
      JSON.stringify(newline),
    );
  }
});

test("non-ASCII dollar-quote tags protect their bodies", () => {
  const sql = `
    DO $migración_変更2$
    BEGIN;
      COMMIT;
      ROLLBACK;
    END;
    $migración_変更2$;
  `;

  assert.doesNotThrow(() => assertMigrationSqlIsAtomic(sql));
});

test("malformed and unterminated dollar-quoted values fail closed", () => {
  assert.throws(
    () => assertMigrationSqlIsAtomic("DO $bad-tag$ BEGIN; END; $bad-tag$;"),
    /malformed dollar-quote tag/,
  );
  assert.throws(
    () => assertMigrationSqlIsAtomic("DO $変更$ BEGIN; COMMIT;"),
    /unterminated dollar-quoted value/,
  );
});

test("runner rejects transaction control before issuing any client query", async () => {
  const sql = "CREATE TABLE public.partial_commit (id INTEGER);\nCOMMIT;\n";
  let queryCount = 0;
  const client = {
    query() {
      queryCount += 1;
      throw new Error("client must not be touched");
    },
  };
  const ledger = {
    advisoryLockKey: "774301992604150",
    ledgerTable: "mentor_connect_schema_migrations",
    migrations: [
      {
        ordinal: 1,
        sequence: 1,
        id: "0001_partial_commit",
        sql,
        sha256: createHash("sha256").update(sql).digest("hex"),
      },
    ],
  };

  await assert.rejects(
    runMigrationTransaction({ client, ledger, appSha: "a".repeat(40) }),
    /transaction-control statement is forbidden/,
  );
  assert.equal(queryCount, 0);
});

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
import {
  runIntegrityPreflight,
  verifyConstraintCatalog,
  verifyExplainPlans,
} from "../tools/integrity.mjs";

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

test("canonical schema reproduces the frozen version 0002 local catalog", async () => {
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

  assert.equal(version.schemaVersion, "0002");
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
    assert.match(
      statusResult.stdout,
      /pending: 2 \(0001_canonical_baseline, 0002_integrity_constraints_indexes\)/,
    );
  } finally {
    await client.end();
  }
});

test("preflight returns deterministic quarantine evidence without changing violating rows", async () => {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await client.connect();
  const ledger = await loadMigrationLedger({ rootDir });
  try {
    await resetPublicSchema(client);
    await client.query(ledger.migrations[0].sql);
    await client.query(`
      ALTER TABLE users DROP CONSTRAINT users_role_check;
      ALTER TABLE requests DROP CONSTRAINT requests_role_check;
      ALTER TABLE requests DROP CONSTRAINT requests_status_check;
      ALTER TABLE request_tags DROP CONSTRAINT request_tags_request_id_tag_id_key;
      ALTER TABLE blocks DROP CONSTRAINT blocks_blocker_id_blocked_user_id_key;
      ALTER TABLE dm_conversations DROP CONSTRAINT dm_conversations_check;
      INSERT INTO districts (id, name, county) VALUES (1, 'District', 'County');
      INSERT INTO tags (id, name) VALUES (1, 'Math');
      INSERT INTO users (id, email, name, password_hash, role, district_id)
      VALUES
        (1, 'one@example.test', 'One', 'hash', 'mentee', 1),
        (2, 'two@example.test', 'Two', 'hash', 'mentor', 1),
        (3, 'invalid@example.test', 'Invalid', 'hash', 'invalid', 1);
      INSERT INTO requests
        (id, author_id, district_id, title, description, role, status)
      VALUES
        (1, 1, 1, 'Valid', 'Valid', 'mentee', 'open'),
        (2, 1, 1, 'Invalid', 'Invalid', 'invalid', 'invalid');
      INSERT INTO request_tags (id, request_id, tag_id)
      VALUES (1, 1, 1), (2, 1, 1);
      INSERT INTO blocks (id, blocker_id, blocked_user_id)
      VALUES (1, 1, 2), (2, 1, 2), (3, 1, 1);
      INSERT INTO reports (id, reporter_id, reported_user_id, reason)
      VALUES (1, 2, 2, 'self');
      INSERT INTO dm_conversations (id, user_a_id, user_b_id)
      VALUES (1, 1, 2), (2, 2, 1), (3, 1, 1);
      SET session_replication_role = replica;
      INSERT INTO users (id, email, name, password_hash, role, district_id)
      VALUES (4, 'orphan@example.test', 'Orphan', 'hash', 'mentee', 999);
      INSERT INTO requests
        (id, author_id, district_id, title, description, role, status, matched_user_id)
      VALUES (3, 999, 999, 'Orphan', 'Orphan', 'mentee', 'open', 999);
      INSERT INTO request_tags (id, request_id, tag_id) VALUES (3, 999, 999);
      INSERT INTO blocks (id, blocker_id, blocked_user_id) VALUES (4, 999, 1000);
      INSERT INTO reports (id, reporter_id, reported_user_id, reason)
      VALUES (2, 999, 1000, 'orphan');
      INSERT INTO questions (id, student_id, subject) VALUES (1, 999, 'Math');
      INSERT INTO schedules (id, user_id, slot) VALUES (1, 999, 'Mon 17:00');
      INSERT INTO chat_rooms (id, type, district_id, name)
      VALUES (1, 'district', 999, 'Orphan room');
      INSERT INTO chat_messages (id, room_id, sender_id, body)
      VALUES (1, 999, 999, 'orphan');
      INSERT INTO dm_conversations (id, user_a_id, user_b_id)
      VALUES (4, 999, 1000);
      INSERT INTO dm_messages (id, conversation_id, sender_id, body)
      VALUES (1, 999, 999, 'orphan');
      SET session_replication_role = origin;
    `);

    const before = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM users) AS users,
        (SELECT count(*)::integer FROM requests) AS requests,
        (SELECT count(*)::integer FROM request_tags) AS request_tags,
        (SELECT count(*)::integer FROM blocks) AS blocks,
        (SELECT count(*)::integer FROM reports) AS reports,
        (SELECT count(*)::integer FROM dm_conversations) AS dm_conversations
    `);
    const evidence = await runIntegrityPreflight(client);
    const after = await client.query(`
      SELECT
        (SELECT count(*)::integer FROM users) AS users,
        (SELECT count(*)::integer FROM requests) AS requests,
        (SELECT count(*)::integer FROM request_tags) AS request_tags,
        (SELECT count(*)::integer FROM blocks) AS blocks,
        (SELECT count(*)::integer FROM reports) AS reports,
        (SELECT count(*)::integer FROM dm_conversations) AS dm_conversations
    `);

    assert.deepEqual(after.rows, before.rows);
    assert.equal(evidence.readOnly, true);
    assert.equal(evidence.cleanupPerformed, false);
    assert.equal(evidence.quarantine.required, true);
    assert.equal(evidence.approvalTaskRequired, true);
    for (const checkId of [
      "invalid_users_role",
      "invalid_requests_role",
      "invalid_requests_status",
      "duplicate_request_tag_pair",
      "duplicate_block_pair",
      "self_block",
      "self_report",
      "noncanonical_dm_pair",
      "duplicate_dm_pair",
      "orphan_block_blocked_user",
      "orphan_block_blocker",
      "orphan_chat_message_room",
      "orphan_chat_message_sender",
      "orphan_chat_room_district",
      "orphan_dm_conversation_user_a",
      "orphan_dm_conversation_user_b",
      "orphan_dm_message_conversation",
      "orphan_dm_message_sender",
      "orphan_question_student",
      "orphan_report_reported_user",
      "orphan_report_reporter",
      "orphan_request_author",
      "orphan_request_district",
      "orphan_request_matched_user",
      "orphan_request_tag_request",
      "orphan_request_tag_tag",
      "orphan_schedule_user",
      "orphan_user_district",
    ]) {
      const check = evidence.checks.find((item) => item.id === checkId);
      assert.ok(check, checkId);
      assert.ok(check.violationCount > 0, checkId);
      assert.ok(check.candidates.length > 0, checkId);
    }
    assert.deepEqual(
      evidence.checks.map((check) => check.id),
      [...evidence.checks.map((check) => check.id)].sort(),
    );
  } finally {
    await client.end();
  }
});

test("forward migration refuses violations, preserves evidence, then enforces invariants", async () => {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await client.connect();
  const ledger = await loadMigrationLedger({ rootDir });
  const baselineLedger = { ...ledger, migrations: [ledger.migrations[0]] };
  try {
    await resetPublicSchema(client);
    await runMigrationTransaction({
      client,
      ledger: baselineLedger,
      appSha: "a".repeat(40),
    });
    await client.query(`
      INSERT INTO districts (id, name, county) VALUES (1, 'District', 'County');
      INSERT INTO users (id, email, name, password_hash, role, district_id)
      VALUES
        (1, 'one@example.test', 'One', 'hash', 'mentee', 1),
        (2, 'two@example.test', 'Two', 'hash', 'mentor', 1);
      INSERT INTO blocks (id, blocker_id, blocked_user_id) VALUES (1, 1, 1);
    `);

    await assert.rejects(
      runMigrationTransaction({
        client,
        ledger,
        appSha: "b".repeat(40),
      }),
      /blocks_no_self_check/,
    );
    assert.equal(
      (await client.query("SELECT count(*)::integer AS count FROM blocks"))
        .rows[0].count,
      1,
    );
    assert.equal(
      (
        await client.query(
          "SELECT count(*)::integer AS count FROM mentor_connect_schema_migrations",
        )
      ).rows[0].count,
      1,
    );

    await client.query("DELETE FROM blocks");
    const applied = await runMigrationTransaction({
      client,
      ledger,
      appSha: "c".repeat(40),
    });
    assert.deepEqual(applied.applied, ["0002_integrity_constraints_indexes"]);
    await assert.rejects(
      client.query(
        "INSERT INTO blocks (blocker_id, blocked_user_id) VALUES (1, 1)",
      ),
      /blocks_no_self_check/,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO reports (reporter_id, reported_user_id, reason) VALUES (1, 1, 'self')",
      ),
      /reports_no_self_check/,
    );
    await assert.rejects(
      client.query(
        "INSERT INTO dm_conversations (user_a_id, user_b_id) VALUES (2, 1)",
      ),
      /dm_conversations_canonical_pair_check/,
    );
  } finally {
    await client.end();
  }
});

test("constraint and representative EXPLAIN verification match version 0002", async () => {
  const client = new Client({
    connectionString: process.env.TEST_DATABASE_URL,
  });
  await client.connect();
  const ledger = await loadMigrationLedger({ rootDir });
  try {
    await resetPublicSchema(client);
    await runMigrationTransaction({
      client,
      ledger,
      appSha: "d".repeat(40),
    });
    await client.query(`
      INSERT INTO districts (id, name, county)
      SELECT value, 'District ' || value, 'County'
      FROM generate_series(1, 100) AS value;
      INSERT INTO tags (id, name)
      SELECT value, 'Tag ' || value
      FROM generate_series(1, 100) AS value;
      INSERT INTO users
        (id, email, name, password_hash, role, district_id, is_verified)
      SELECT
        value,
        'user-' || lpad(value::text, 5, '0') || '@example.test',
        'User ' || value,
        'hash',
        CASE WHEN value % 2 = 0 THEN 'mentor' ELSE 'mentee' END,
        (value % 100) + 1,
        value % 20 <> 0
      FROM generate_series(1, 5000) AS value;
      INSERT INTO requests
        (id, author_id, district_id, title, description, role, status)
      SELECT
        value,
        value,
        (value % 100) + 1,
        'Request ' || value,
        'Description',
        CASE WHEN value % 2 = 0 THEN 'mentor' ELSE 'mentee' END,
        CASE WHEN value % 100 = 0 THEN 'open' ELSE 'closed' END
      FROM generate_series(1, 5000) AS value;
      INSERT INTO request_tags (request_id, tag_id)
      SELECT value, (value % 100) + 1
      FROM generate_series(1, 5000) AS value;
      ANALYZE users;
      ANALYZE requests;
      ANALYZE request_tags;
    `);

    const expectedCatalog = JSON.parse(
      await readFile(
        path.join(rootDir, "database/schema/local-catalog.json"),
        "utf8",
      ),
    );
    assert.deepEqual(
      await verifyConstraintCatalog(client, expectedCatalog.constraints),
      { readOnly: true, differences: [] },
    );

    const plans = await verifyExplainPlans(client);
    assert.equal(plans.readOnly, true);
    assert.equal(plans.failures.length, 0);
    assert.deepEqual(
      plans.queries.map((query) => query.id),
      [
        "district_lookup",
        "email_lookup",
        "matching_lookup",
        "open_request_lookup",
        "request_tag_lookup",
        "status_lookup",
      ],
    );

    const cliEnvironment = {
      ...process.env,
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    };
    for (const [command, pattern] of [
      ["migration:preflight", /violations 0; quarantine not-required/],
      ["constraints:verify", /constraint differences 0 \(read-only\)/],
      ["explain:verify", /query plans 6\/6 expected \(read-only\)/],
    ]) {
      const result = await execFile(
        process.execPath,
        [cliPath, command, "--env", "local"],
        { cwd: rootDir, env: cliEnvironment },
      );
      assert.match(result.stdout, pattern, command);
      if (command === "migration:preflight") {
        const evidence = JSON.parse(result.stdout.trim().split("\n").at(-1));
        assert.equal(evidence.schemaVersion, "0002");
        assert.equal(evidence.targetEnvironment, "local");
      }
    }
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
      applied: [
        "0001_canonical_baseline",
        "0002_integrity_constraints_indexes",
      ],
      alreadyApplied: [],
    });

    const persisted = await runnerClient.query(`
      SELECT ordinal, migration_id AS "migrationId", checksum, applied_at AS "appliedAt", app_sha AS "appSha"
      FROM mentor_connect_schema_migrations
      ORDER BY ordinal
    `);
    assert.equal(persisted.rows.length, 2);
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

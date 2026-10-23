import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import pg from "pg";
import { diffCatalog, introspectCatalog } from "../tools/catalog.mjs";
import { verifySchemaAssets } from "../tools/schema-assets.mjs";
import { runMigrationTransaction } from "../tools/migration-runner.mjs";
import { snapshotSchemaAssets } from "../../../ops/snapshot-schema.mjs";
import { restrictAccountTrustUserWrites } from "../../../ops/account-trust-grants.mjs";

const rootDir = path.resolve(import.meta.dirname, "../../..");
const migrationId = "0009_student_privacy_notifications";

test("0008 upgrade preserves every old column and ACL while adding privacy and durable notices", async () => {
  const target = new URL(process.env.TEST_DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1");
  assert.notEqual(target.port, "");
  const assets = await verifySchemaAssets({ rootDir });
  assert.equal(assets.ledger.migrations.at(-1).id, migrationId);
  const previous = await snapshotSchemaAssets({ rootDir, schemaVersion: "0008" });
  const client = new pg.Client({ connectionString: target.href });
  await client.connect();
  try {
    await runMigrationTransaction({ client, ledger: previous.ledger, appSha: "a".repeat(40) });
    await client.query(await readFile(path.join(rootDir, "tests/fixtures/chat-canonical.sql"), "utf8"));
    await client.query(`
      UPDATE users SET is_verified=true, email_verified_at='2026-10-01T00:00:00Z', is_admin=(id=1);
      INSERT INTO requests(author_id,district_id,title,description,role)
        VALUES(1,1,repeat('Historic title ',8),'Original description','mentee');
      INSERT INTO request_tags(request_id,tag_id) VALUES(1,1);
      INSERT INTO notifications(user_id,kind,request_id,message)
        VALUES(501,'request_match',1,'Original mentor notice'),
              (1,'request_match_summary',1,'Original author summary');
      CREATE ROLE privacy_test_app NOLOGIN;
      GRANT USAGE ON SCHEMA public TO privacy_test_app;
      GRANT SELECT ON users TO privacy_test_app;
      GRANT USAGE ON users_id_seq TO privacy_test_app;
    `);
    await restrictAccountTrustUserWrites(client, "privacy_test_app");

    // Capture every old column, including hashes, taxonomy, timestamps and DM read state.
    const originalCatalog = await introspectCatalog(client);
    assert.deepEqual(diffCatalog(previous.catalog, originalCatalog), []);
    async function snapshot() {
      const rows = {};
      for (const table of originalCatalog.tables) {
        const columns = originalCatalog.columns.filter((column) => column.table === table)
          .map((column) => `"${column.name}"`).join(",");
        rows[table] = (await client.query(`SELECT ${columns} FROM "${table}" ORDER BY ${columns}`)).rows;
      }
      rows.ledger = (await client.query("SELECT * FROM mentor_connect_schema_migrations WHERE ordinal<=8 ORDER BY ordinal")).rows;
      rows.acls = (await client.query(`SELECT table_name,column_name,privilege_type,is_grantable
        FROM information_schema.column_privileges WHERE grantee='privacy_test_app'
        AND NOT (table_name='users' AND column_name IN ('gender','date_of_birth'))
        ORDER BY table_name,column_name,privilege_type`)).rows;
      return rows;
    }
    const before = await snapshot();

    await assert.rejects(runMigrationTransaction({
      client, ledger: assets.ledger, appSha: "b".repeat(40),
      afterApply: async () => { throw new Error("injected verification failure"); },
    }), /injected verification failure/);
    assert.deepEqual(diffCatalog(originalCatalog, await introspectCatalog(client)), []);
    assert.deepEqual(await snapshot(), before);

    const result = await runMigrationTransaction({ client, ledger: assets.ledger, appSha: "c".repeat(40) });
    assert.deepEqual(result.applied, [migrationId]);
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(diffCatalog(assets.catalog, await introspectCatalog(client)), []);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM users WHERE gender IS NOT NULL OR date_of_birth IS NOT NULL")).rows[0].n, 0);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM requests WHERE audience<>'both'")).rows[0].n, 0);
    assert.equal((await client.query("SELECT count(*)::int AS n FROM notifications WHERE event_key IS NOT NULL")).rows[0].n, 0);
    assert.deepEqual((await runMigrationTransaction({ client, ledger: assets.ledger, appSha: "d".repeat(40) })).applied, []);
    assert.deepEqual(await snapshot(), before);

    // A schema-only migration must not silently expand the runtime account's rights.
    await client.query("SET ROLE privacy_test_app");
    const signup = `INSERT INTO users(email,name,password_hash,role,district_id,gender,date_of_birth)
      VALUES('privacy-new@test.edu','New student','synthetic hash','mentee',1,'female','2010-01-02') RETURNING gender,date_of_birth::text`;
    await assert.rejects(client.query(signup), { code: "42501" });
    await client.query("RESET ROLE");
    // This grant is limited to the disposable test role, never a deployment role.
    await client.query("GRANT INSERT(gender,date_of_birth) ON users TO privacy_test_app");
    await client.query("SET ROLE privacy_test_app");
    assert.deepEqual((await client.query(signup)).rows, [{ gender: "female", date_of_birth: "2010-01-02" }]);
    await assert.rejects(client.query("UPDATE users SET gender='male' WHERE email='privacy-new@test.edu'"), { code: "42501" });
    await assert.rejects(client.query("UPDATE users SET is_admin=true"), { code: "42501" });
    await client.query("RESET ROLE");

    await assert.rejects(client.query("UPDATE users SET gender='unknown' WHERE id=1"), { code: "23514" });
    await assert.rejects(client.query("UPDATE requests SET audience='unknown' WHERE id=1"), { code: "23514" });
    await assert.rejects(client.query("UPDATE requests SET audience=NULL WHERE id=1"), { code: "23502" });
    for (const audience of ["female", "male", "both"]) {
      await client.query("INSERT INTO requests(author_id,district_id,title,description,role,audience) VALUES(1,1,'New','New','mentee',$1)", [audience]);
    }
    for (const kind of ["request_match", "request_match_summary"]) {
      const userId = kind === "request_match" ? 501 : 1;
      await assert.rejects(client.query("INSERT INTO notifications(user_id,kind,request_id,message) VALUES($1,$2,1,'Duplicate')", [userId, kind]), { code: "23505" });
    }
    for (const userId of [1, 501]) {
      for (const applicationId of [10, 11]) {
        await client.query(`INSERT INTO notifications(user_id,kind,request_id,message,event_key)
          VALUES($1,'request_accepted',1,'Accepted',$2)`, [userId, `request_accepted:application:${applicationId}`]);
      }
      await assert.rejects(client.query(`INSERT INTO notifications(user_id,kind,request_id,message,event_key)
        VALUES($1,'request_accepted',1,'Replay','request_accepted:application:10')`, [userId]), { code: "23505" });
    }
    await assert.rejects(client.query("INSERT INTO notifications(user_id,kind,message) VALUES(1,'invented','Invalid')"), { code: "23514" });
    assert.equal((await client.query("SELECT count(*)::int AS n FROM notifications WHERE kind='request_accepted'")).rows[0].n, 4);
  } finally {
    await client.end();
  }
});

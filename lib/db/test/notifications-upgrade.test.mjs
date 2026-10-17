import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "../../../ops/classroom-snapshot.mjs";
import { verifySchemaAssets } from "../tools/schema-assets.mjs";
import { runMigrationTransaction } from "../tools/migration-runner.mjs";
import { restrictAccountTrustUserWrites } from "../../../ops/account-trust-grants.mjs";
import { backupClassroom } from "../../../ops/backup-classroom.mjs";
import { restoreClassroom } from "../../../ops/restore-classroom.mjs";

const rootDir = path.resolve(import.meta.dirname, "../../..");
const upgrade = await import("../../../ops/upgrade-notifications.mjs").catch(
  (error) => {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {};
  },
);
const integration = process.env.TEST_DATABASE_URL ? test : test.skip;
let sequence = 0;

test("notifications is an explicit migration 0007 after unchanged account trust", async () => {
  const assets = await verifySchemaAssets({ rootDir });
  assert.equal(assets.version.schemaVersion, "0007");
  assert.equal(assets.ledger.migrations.at(-1).id, "0007_notifications");
  assert.equal(
    assets.ledger.migrations[5].sha256,
    "744fa0f04b51fd8a49f29084b06a5486126668e5ab6cd90911c0832a6dd7279f",
  );
  assert.equal(typeof upgrade.upgradeNotifications, "function");
});

test("operator connection accepts only the selected loopback rehearsal target", () => {
  assert.equal(typeof upgrade.notificationsConnection, "function");
  const target = {
    host: "127.0.0.1",
    port: 5432,
    database: "notifications_upgrade_local",
    appRole: "notifications_app",
  };
  assert.equal(
    upgrade.notificationsConnection(
      "postgresql://127.0.0.1/notifications_upgrade_local",
      target,
    ).env.PGDATABASE,
    target.database,
  );
  for (const [url, changed] of [
    [
      "postgresql://remote.invalid/notifications_upgrade_local",
      { ...target, host: "remote.invalid" },
    ],
    ["postgresql://127.0.0.1/other", target],
    ["postgresql://127.0.0.1:5433/notifications_upgrade_local", target],
    [
      "postgresql://127.0.0.1/notifications_upgrade_local",
      { ...target, appRole: "bad;role" },
    ],
  ])
    assert.throws(() => upgrade.notificationsConnection(url, changed));
});

async function fixture() {
  const name = "notifications_upgrade_" + ++sequence,
    role = "notifications_app_" + sequence;
  const admin = new Client({ connectionString: process.env.TEST_DATABASE_URL });
  await admin.connect();
  await admin.query("CREATE DATABASE " + name);
  await admin.query("CREATE ROLE " + role + " NOLOGIN");
  const url = new URL(process.env.TEST_DATABASE_URL);
  url.pathname = "/" + name;
  const client = new Client({ connectionString: url.href });
  await client.connect();
  const assets = await verifySchemaAssets({ rootDir });
  await runMigrationTransaction({
    client,
    ledger: {
      ...assets.ledger,
      migrations: assets.ledger.migrations.slice(0, 6),
    },
    appSha: "a".repeat(40),
  });
  await client.query(
    await readFile(
      path.join(rootDir, "tests/fixtures/chat-canonical.sql"),
      "utf8",
    ),
  );
  await client.query(
    "UPDATE users SET is_verified=true,email_verified_at='2026-10-01T00:00:00Z',is_admin=(id=1)",
  );
  await client.query(
    "INSERT INTO requests(author_id,district_id,title,description,role) VALUES (1,1,'Preserved request','Existing content','mentee')",
  );
  await client.query(
    `GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON users,requests TO ${role}; GRANT USAGE ON users_id_seq TO ${role}`,
  );
  await restrictAccountTrustUserWrites(client, role);
  const target = {
    host: url.hostname,
    port: Number(url.port),
    database: name,
    appRole: role,
  };
  return {
    client,
    role,
    assets,
    target,
    async close() {
      await client.end();
      await admin.query("DROP DATABASE " + name + " WITH (FORCE)");
      await admin.query("DROP ROLE " + role);
      await admin.end();
    },
  };
}
async function content(client) {
  return (
    await client.query(
      "SELECT jsonb_build_object('users',(SELECT jsonb_agg(u ORDER BY id) FROM users u),'requests',(SELECT jsonb_agg(r ORDER BY id) FROM requests r),'chat',(SELECT jsonb_agg(c ORDER BY id) FROM chat_messages c),'grants',(SELECT jsonb_agg(g ORDER BY privilege_type,column_name) FROM information_schema.column_privileges g WHERE table_name='users')) AS value",
    )
  ).rows[0].value;
}
const apply = (f, audit = async () => {}) =>
  upgrade.upgradeNotifications({
    client: f.client,
    assets: f.assets,
    target: f.target,
    appSha: "b".repeat(40),
    audit,
    acknowledged: true,
  });

integration(
  "0006 to 0007 preserves all user authority and content, adds exact runtime notification rights",
  async () => {
    const f = await fixture();
    try {
      const before = await content(f.client),
        audit = [];
      const result = await apply(f, async (record) => audit.push(record));
      assert.deepEqual(result.applied, ["0007_notifications"]);
      assert.deepEqual(await content(f.client), before);
      assert.equal(
        (
          await f.client.query(
            "SELECT count(*)::int AS n FROM mentor_connect_schema_migrations",
          )
        ).rows[0].n,
        7,
      );
      assert.equal(audit.at(-1).result, "verified-before-commit");
      await f.client.query("SET ROLE " + f.role);
      const notification = (
        await f.client.query(
          "INSERT INTO notifications(user_id,kind,request_id,message) VALUES (1,'request_match_summary',NULL,'Local rehearsal') RETURNING *",
        )
      ).rows[0];
      assert.equal(notification.read_at, null);
      assert.equal(
        (
          await f.client.query(
            "UPDATE notifications SET read_at=now() WHERE id=$1 RETURNING id",
            [notification.id],
          )
        ).rowCount,
        1,
      );
      assert.equal(
        (await f.client.query("SELECT count(*)::int AS n FROM notifications"))
          .rows[0].n,
        1,
      );
      for (const query of [
        "UPDATE notifications SET message='forged'",
        "UPDATE notifications SET user_id=2",
        "DELETE FROM notifications",
        "TRUNCATE notifications",
        "ALTER TABLE notifications ADD COLUMN unsafe int",
        "CREATE TABLE runtime_ddl(id int)",
        "UPDATE users SET is_admin=true",
      ]) {
        await assert.rejects(f.client.query(query), { code: "42501" });
      }
      await f.client.query("RESET ROLE");
      await assert.rejects(apply(f), /precondition/);
    } finally {
      await f.close();
    }
  },
);

integration(
  "failure after grants rolls back notification schema, ledger and ACLs",
  async () => {
    const f = await fixture();
    try {
      const before = await content(f.client);
      await assert.rejects(
        apply(f, async (record) => {
          if (record.result === "verified-before-commit")
            throw new Error("injected audit failure");
        }),
        /injected audit failure/,
      );
      assert.deepEqual(await content(f.client), before);
      assert.equal(
        (
          await f.client.query(
            "SELECT to_regclass('notifications') AS relation,to_regclass('notifications_id_seq') AS sequence",
          )
        ).rows[0].relation,
        null,
      );
      assert.equal(
        (
          await f.client.query(
            "SELECT count(*)::int AS n FROM mentor_connect_schema_migrations",
          )
        ).rows[0].n,
        6,
      );
    } finally {
      await f.close();
    }
  },
);

integration(
  "explicit 0006 backup restores the pre-notifications source into a separate empty target",
  async () => {
    const f = await fixture();
    const scratch = await mkdtemp(path.join(tmpdir(), "notify-recovery-"));
    const admin = new Client({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await admin.connect();
    const name = "notifications_restore_" + sequence;
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = "/" + name;
    let target;
    try {
      const sourceUrl = new URL(process.env.TEST_DATABASE_URL);
      sourceUrl.pathname = "/" + f.target.database;
      const before = (await f.client.query("SELECT * FROM users ORDER BY id"))
        .rows;
      const backup = await backupClassroom({
        databaseUrl: sourceUrl.href,
        allowedHost: "127.0.0.1",
        databaseName: f.target.database,
        outputDir: scratch,
        schemaVersion: "0006",
      });
      assert.equal(backup.schemaVersion, "0006");
      await apply(f);
      await admin.query("CREATE DATABASE " + name);
      await assert.rejects(
        restoreClassroom({
          databaseUrl: url.href,
          allowedHost: "127.0.0.1",
          databaseName: name,
          dumpPath: backup.dumpPath,
        }),
        /schema version mismatch/,
      );
      const restored = await restoreClassroom({
        databaseUrl: url.href,
        allowedHost: "127.0.0.1",
        databaseName: name,
        dumpPath: backup.dumpPath,
        schemaVersion: "0006",
      });
      assert.equal(restored.schemaVersion, "0006");
      assert.equal(restored.verified, true);
      target = new Client({ connectionString: url.href });
      await target.connect();
      assert.deepEqual(
        (await target.query("SELECT * FROM users ORDER BY id")).rows,
        before,
      );
      assert.equal(
        (await target.query("SELECT to_regclass('notifications') AS relation"))
          .rows[0].relation,
        null,
      );
      assert.equal(
        (
          await target.query(
            "SELECT count(*)::int AS n FROM mentor_connect_schema_migrations",
          )
        ).rows[0].n,
        6,
      );
    } finally {
      if (target) await target.end();
      await admin.query("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)");
      await admin.end();
      await f.close();
      await rm(scratch, { recursive: true, force: true });
    }
  },
);

for (const existing of [
  "CREATE TABLE notifications(id int,legacy text)",
  "CREATE SEQUENCE notifications_id_seq",
  "CREATE TABLE unrelated(id int); CREATE INDEX idx_notifications_user_created ON unrelated(id)",
]) {
  integration(
    "does not adopt preexisting runtime-created notification objects: " +
      existing.split(" ")[1],
    async () => {
      const f = await fixture();
      try {
        await f.client.query(existing);
        const before = await content(f.client);
        await assert.rejects(apply(f), /precondition/);
        assert.deepEqual(await content(f.client), before);
        assert.equal(
          (
            await f.client.query(
              "SELECT count(*)::int AS n FROM mentor_connect_schema_migrations",
            )
          ).rows[0].n,
          6,
        );
      } finally {
        await f.close();
      }
    },
  );
}

for (const unsafe of [
  "schema-create",
  "admin-write",
  "public-default-grants",
  "app-default-grants",
]) {
  integration(
    "rejects unsafe runtime authority atomically: " + unsafe,
    async () => {
      const f = await fixture();
      try {
        if (unsafe === "schema-create")
          await f.client.query("GRANT CREATE ON SCHEMA public TO " + f.role);
        if (unsafe === "admin-write")
          await f.client.query("GRANT UPDATE(is_admin) ON users TO " + f.role);
        if (unsafe === "public-default-grants")
          await f.client.query(
            "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO PUBLIC",
          );
        if (unsafe === "app-default-grants")
          await f.client.query(
            "ALTER DEFAULT PRIVILEGES GRANT ALL ON TABLES TO " + f.role,
          );
        const before = await content(f.client);
        await assert.rejects(apply(f), /precondition/);
        assert.deepEqual(await content(f.client), before);
        assert.equal(
          (await f.client.query("SELECT to_regclass('notifications') AS name"))
            .rows[0].name,
          null,
        );
        assert.equal(
          (
            await f.client.query(
              "SELECT count(*)::int AS n FROM mentor_connect_schema_migrations",
            )
          ).rows[0].n,
          6,
        );
      } finally {
        await f.close();
      }
    },
  );
}

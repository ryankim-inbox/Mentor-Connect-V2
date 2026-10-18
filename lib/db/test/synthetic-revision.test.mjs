import assert from "node:assert/strict";
import test from "node:test";
const revision =
  await import("../../../ops/revise-synthetic-classroom.mjs").catch((error) => {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {};
  });

test("provides an explicit-client revision operator separate from the insert-only seed", () => {
  assert.equal(typeof revision.reviseSyntheticClassroom, "function");
});

const integration = process.env.TEST_SYNTHETIC_REVISION_DATABASE_URL
  ? test
  : test.skip;
const releaseSha = "a".repeat(40);
let serial = 0;
async function database(callback) {
  const { Client } = await import("../../../ops/classroom-snapshot.mjs");
  const { seedSyntheticClassroom } =
    await import("../../../ops/seed-synthetic-classroom.mjs");
  const { runMigrationTransaction } =
    await import("../tools/migration-runner.mjs");
  const { verifySchemaAssets } = await import("../tools/schema-assets.mjs");
  const { readFile } = await import("node:fs/promises");
  const source = new URL(process.env.TEST_SYNTHETIC_REVISION_DATABASE_URL);
  assert.equal(
    source.hostname,
    "127.0.0.1",
    "only the disposable loopback cluster is supported",
  );
  const admin = new Client({ connectionString: source.href, password: "" });
  await admin.connect();
  const name = `revision_${process.pid}_${++serial}`;
  await admin.query(`CREATE DATABASE ${name}`);
  source.pathname = "/" + name;
  const client = new Client({ connectionString: source.href, password: "" });
  await client.connect();
  try {
    const rootDir = new URL("../../../", import.meta.url).pathname;
    const { ledger } = await verifySchemaAssets({ rootDir });
    await runMigrationTransaction({ client, ledger, appSha: releaseSha });
    await client.query(
      await readFile(
        new URL("../../../database/fixtures/classroom.sql", import.meta.url),
        "utf8",
      ),
    );
    const asOf = new Date(Date.now() - 60_000).toISOString();
    await client.query(
      "UPDATE request_events SET occurred_at=$1::timestamptz-interval '90 days' WHERE kind='tracking_started'",
      [asOf],
    );
    // Genuine nonbatch fixtures, including a privileged account and post-seed QA.
    await client.query(
      "INSERT INTO users(email,name,password_hash,role,district_id,is_verified,email_verified_at,is_admin) VALUES ('original@real.invalid','Original owner','opaque-original-password','mentor',1,true,now(),true),('peer@real.invalid','Original peer','opaque-peer-password','mentee',2,false,NULL,false)",
    );
    await client.query(
      "INSERT INTO questions(student_id,subject,message) VALUES(2,'Math','Original question')",
    );
    await client.query(
      "INSERT INTO requests(author_id,district_id,title,description,role) VALUES(2,2,'Original request','Original content','mentee')",
    );
    const receipt = await seedSyntheticClassroom({ client, asOf, apply: true });
    await client.query(
      "INSERT INTO requests(author_id,district_id,title,description,role) VALUES(1,1,'Fresh QA request','Content added after old seed','mentor')",
    );
    await client.query(
      "INSERT INTO request_comments(request_id,author_id,body,client_comment_id) VALUES(1,1,'Fresh QA comment','00000000-0000-4000-8000-000000000001')",
    );
    await client.query(
      "INSERT INTO chat_messages(room_id,sender_id,body) VALUES(1,1,'Fresh QA chat')",
    );
    await client.query(
      "INSERT INTO dm_conversations(user_a_id,user_b_id) VALUES(1,2)",
    );
    await client.query(
      "INSERT INTO dm_messages(conversation_id,sender_id,body) VALUES(1,1,'Fresh QA direct message')",
    );
    const identity = (
      await client.query(
        'SELECT current_database() AS database,current_user AS user,inet_server_addr()::text AS "serverAddress",inet_server_port() AS "serverPort"',
      )
    ).rows[0];
    const options = { client, receipt, expectedTarget: identity, releaseSha };
    await callback({ client, receipt, options, Client, url: source.href });
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`);
    await admin.end();
  }
}
function authority(preview, overrides = {}) {
  const now = new Date().toISOString();
  return {
    apply: true,
    expectedPreviewDigest: preview.previewDigest,
    refreshWriterEvidence: async () => ({
      verifiedAt: new Date().toISOString(),
      targetDigest: preview.evidence.targetDigest,
      releaseSha,
      evidenceDigest: "c".repeat(64),
    }),
    prerequisites: {
      ...preview.evidence,
      backup: {
        sha256: "b".repeat(64),
        createdAt: now,
        targetDigest: preview.evidence.targetDigest,
        baselineDigest: preview.evidence.baselineDigest,
      },
      restore: {
        backupSha256: "b".repeat(64),
        verifiedAt: now,
        baselineDigest: preview.evidence.baselineDigest,
      },
      writers: {
        verifiedAt: now,
        targetDigest: preview.evidence.targetDigest,
        releaseSha,
      },
    },
    claim: {
      revisionId: preview.revisionId,
      attemptId: "local-test-attempt",
      previewDigest: preview.previewDigest,
      releaseSha,
      state: "claimed",
    },
    ...overrides,
  };
}
async function fingerprint(client) {
  const names = (
    await client.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
    )
  ).rows;
  const result = {};
  for (const { tablename } of names)
    result[tablename] = (
      await client.query(
        `SELECT encode(sha256(convert_to(coalesce(string_agg(to_jsonb(t)::text, E'\\n' ORDER BY to_jsonb(t)::text),''),'UTF8')),'hex') AS hash FROM "${tablename}" t`,
      )
    ).rows[0].hash;
  result.sequences = {};
  for (const { sequencename: name } of (
    await client.query(
      "SELECT sequencename FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
    )
  ).rows)
    result.sequences[name] = (
      await client.query(`SELECT last_value::text,is_called FROM "${name}"`)
    ).rows[0];
  return result;
}

integration(
  "preview is read-only and successful revision preserves every nonbatch row and password fingerprint",
  async () =>
    database(async ({ client, receipt, options }) => {
      const before = await fingerprint(client);
      const passwordBefore = (
        await client.query(
          "SELECT encode(sha256(convert_to(password_hash,'UTF8')),'hex') AS digest FROM users WHERE id=1",
        )
      ).rows[0].digest;
      const preview = await revision.reviseSyntheticClassroom(options);
      assert.equal(preview.operation, "planned-revision");
      assert.deepEqual(await fingerprint(client), before);
      assert.equal(preview.metadata.inserts.districts.length, 24);
      assert.equal(preview.metadata.inserts.tags.length, 18);
      const applied = await revision.reviseSyntheticClassroom({
        ...options,
        ...authority(preview),
      });
      assert.equal(applied.operation, "revised");
      assert.deepEqual(applied.ids, receipt.ids);
      assert.equal(applied.before.nonBatchDigest, applied.after.nonBatchDigest);
      assert.equal(applied.before.schemaDigest, applied.after.schemaDigest);
      assert.equal(
        (
          await client.query(
            "SELECT encode(sha256(convert_to(password_hash,'UTF8')),'hex') AS digest FROM users WHERE id=1",
          )
        ).rows[0].digest,
        passwordBefore,
      );
      assert.equal(
        (await client.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
        985,
      );
      assert.equal(
        (await client.query("SELECT count(*)::int AS n FROM questions")).rows[0]
          .n,
        783,
      );
      assert.equal(
        (await client.query("SELECT count(*)::int AS n FROM requests")).rows[0]
          .n,
        784,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM request_applications a JOIN requests r ON r.id=a.request_id JOIN users u ON u.id=a.applicant_id JOIN request_tags rt ON rt.request_id=r.id JOIN tags t ON t.id=rt.tag_id WHERE r.id=ANY($1::int[]) AND (u.district_id<>r.district_id OR NOT t.name=ANY(u.subjects) OR u.role NOT IN ('mentor','both') OR (r.status<>'open' AND r.matched_user_id<>u.id))",
            [receipt.ids.requests],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM request_events e JOIN requests r ON r.id=e.request_id WHERE e.id=ANY($1::bigint[]) AND e.mentor_id IS DISTINCT FROM r.matched_user_id",
            [receipt.ids.request_events],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query(
            "INSERT INTO districts(name,county,type) VALUES('Later district','Later County','unified') RETURNING id",
          )
        ).rows[0].id,
        preview.metadata.next.districts,
      );
      assert.equal(
        (
          await client.query(
            "INSERT INTO tags(name) VALUES('Later interest') RETURNING id",
          )
        ).rows[0].id,
        preview.metadata.next.tags,
      );
      const final = await fingerprint(client);
      await assert.rejects(
        revision.reviseSyntheticClassroom({
          ...options,
          ...authority(preview),
        }),
        /precondition|old seed|already|differs|changed/,
      );
      assert.deepEqual(await fingerprint(client), final);
    }),
);

integration(
  "rejects stale preview on fresh nonbatch QA instead of overwriting it",
  async () =>
    database(async ({ client, options }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      await client.query(
        "UPDATE requests SET description='Even newer QA content' WHERE id=1",
      );
      const before = await fingerprint(client);
      await assert.rejects(
        revision.reviseSyntheticClassroom({
          ...options,
          ...authority(preview),
        }),
        /preview.*changed|digest/,
      );
      assert.deepEqual(await fingerprint(client), before);
    }),
);

integration(
  "rejects changed batch fields, protected credentials, and incorrect receipt IDs",
  async () =>
    database(async ({ client, receipt, options }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      await client.query("UPDATE users SET name='A later change' WHERE id=$1", [
        receipt.ids.users[0],
      ]);
      const before = await fingerprint(client);
      await assert.rejects(
        revision.reviseSyntheticClassroom({
          ...options,
          ...authority(preview),
        }),
        /precondition|old seed|differs/,
      );
      assert.deepEqual(await fingerprint(client), before);
      await client.query(
        "UPDATE users SET name='[Synthetic] Student 0001',password_hash='changed-protected-password' WHERE id=$1",
        [receipt.ids.users[0]],
      );
      const credentialBefore = await fingerprint(client);
      await assert.rejects(
        revision.reviseSyntheticClassroom(options),
        /precondition|old seed|differs/,
      );
      assert.deepEqual(await fingerprint(client), credentialBefore);
      const bad = structuredClone(receipt);
      bad.ids.users[0] = 1;
      await assert.rejects(
        revision.reviseSyntheticClassroom({ ...options, receipt: bad }),
        /precondition|old seed|receipt|differs|cross.batch/,
      );
    }),
);

integration(
  "rejects unplanned inbound references and extra batch-owned rows",
  async () =>
    database(async ({ client, receipt, options }) => {
      await client.query(
        "INSERT INTO blocks(blocker_id,blocked_user_id) VALUES(1,$1)",
        [receipt.ids.users[0]],
      );
      const before = await fingerprint(client);
      await assert.rejects(
        revision.reviseSyntheticClassroom(options),
        /cross.batch|unplanned.*reference/,
      );
      assert.deepEqual(await fingerprint(client), before);
      await client.query("DELETE FROM blocks");
      await client.query(
        "INSERT INTO questions(student_id,subject,message) VALUES($1,'Math','Unreceipted extra question')",
        [receipt.ids.users[0]],
      );
      await assert.rejects(
        revision.reviseSyntheticClassroom(options),
        /cross.batch|unplanned|receipt/,
      );
    }),
);

integration(
  "rolls back metadata, sequence changes and every row after a precommit failure",
  async () =>
    database(async ({ client, options }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      const before = await fingerprint(client);
      let injected = false;
      const faultClient = {
        query(sql, ...params) {
          if (sql === "SET CONSTRAINTS ALL IMMEDIATE") {
            injected = true;
            throw new Error("injected precommit failure");
          }
          return client.query(sql, ...params);
        },
      };
      await assert.rejects(
        revision.reviseSyntheticClassroom({
          ...options,
          client: faultClient,
          ...authority(preview),
        }),
        /injected precommit failure/,
      );
      assert.ok(injected);
      assert.deepEqual(await fingerprint(client), before);
    }),
);

integration(
  "rejects a wrong target, stale backup, read-only apply, and another connected client",
  async () =>
    database(async ({ client, options, Client, url }) => {
      await assert.rejects(
        revision.reviseSyntheticClassroom({
          ...options,
          expectedTarget: { ...options.expectedTarget, database: "wrong" },
        }),
        /target/,
      );
      const preview = await revision.reviseSyntheticClassroom(options);
      const a = authority(preview);
      a.prerequisites.backup.createdAt = "2001-01-01T00:00:00.000Z";
      await assert.rejects(
        revision.reviseSyntheticClassroom({ ...options, ...a }),
        /backup|fresh/,
      );
      await client.query("SET default_transaction_read_only=on");
      await assert.rejects(
        revision.reviseSyntheticClassroom({
          ...options,
          ...authority(preview),
        }),
        /read.only/,
      );
      await client.query("SET default_transaction_read_only=off");
      const other = new Client({ connectionString: url, password: "" });
      await other.connect();
      try {
        await assert.rejects(
          revision.reviseSyntheticClassroom({
            ...options,
            ...authority(preview),
          }),
          /other.*client/,
        );
      } finally {
        await other.end();
      }
    }),
);

integration("rejects an altered FK catalog before any mutation", async () =>
  database(async ({ client, options }) => {
    await client.query(
      "ALTER TABLE request_applications DROP CONSTRAINT request_applications_applicant_id_fkey",
    );
    const before = await fingerprint(client);
    await assert.rejects(
      revision.reviseSyntheticClassroom(options),
      /catalog|schema/,
    );
    assert.deepEqual(await fingerprint(client), before);
  }),
);

integration(
  "a reference committed between initial identity and locks is observed and rejected",
  async () =>
    database(async ({ client, receipt, options, Client, url }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      let once = false;
      const raced = {
        async query(sql, ...args) {
          const result = await client.query(sql, ...args);
          if (!once && sql.startsWith("SELECT current_database()")) {
            once = true;
            const writer = new Client({ connectionString: url, password: "" });
            await writer.connect();
            try {
              await writer.query(
                "INSERT INTO blocks(blocker_id,blocked_user_id) VALUES(1,$1)",
                [receipt.ids.users[0]],
              );
            } finally {
              await writer.end();
            }
          }
          return result;
        },
      };
      await assert.rejects(
        revision.reviseSyntheticClassroom({
          ...options,
          client: raced,
          ...authority(preview),
        }),
        /cross.batch|unplanned/,
      );
      assert.ok(once);
      assert.equal(
        (await client.query("SELECT count(*)::int AS n FROM districts")).rows[0]
          .n,
        2,
      );
    }),
);

integration(
  "unknown COMMIT acknowledgement is surfaced without retry after an actual successful commit",
  async () =>
    database(async ({ client, options }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      let commits = 0;
      const uncertain = {
        async query(sql, ...args) {
          const result = await client.query(sql, ...args);
          if (sql === "COMMIT") {
            commits++;
            throw new Error("transport lost after committed");
          }
          return result;
        },
      };
      await assert.rejects(
        revision.reviseSyntheticClassroom({
          ...options,
          client: uncertain,
          ...authority(preview),
        }),
        (error) => error.code === "REVISION_COMMIT_UNCERTAIN",
      );
      assert.equal(commits, 1);
      assert.equal(
        (await client.query("SELECT count(*)::int AS n FROM districts")).rows[0]
          .n,
        26,
      );
    }),
);

integration(
  "a connected different-role client and a late client both block apply",
  async () =>
    database(async ({ client, options, Client, url }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      const other = new Client({ connectionString: url, password: "" });
      let opened = false;
      const late = {
        async query(sql, ...args) {
          const result = await client.query(sql, ...args);
          if (!opened && sql === "SET CONSTRAINTS ALL IMMEDIATE") {
            opened = true;
            await other.connect();
          }
          return result;
        },
      };
      const before = await fingerprint(client);
      try {
        await assert.rejects(
          revision.reviseSyntheticClassroom({
            ...options,
            client: late,
            ...authority(preview),
          }),
          /other.*client/,
        );
      } finally {
        if (opened) await other.end();
      }
      assert.deepEqual(await fingerprint(client), before);
      const roleName = `inspection_${process.pid}_${serial}`;
      await client.query(`CREATE ROLE ${roleName} LOGIN`);
      const roleUrl = new URL(url);
      roleUrl.username = roleName;
      const roleClient = new Client({
        connectionString: roleUrl.href,
        password: "",
      });
      await roleClient.connect();
      try {
        await assert.rejects(
          revision.reviseSyntheticClassroom({
            ...options,
            ...authority(preview),
          }),
          /other.*client/,
        );
      } finally {
        await roleClient.end();
        await client.query(`DROP ROLE ${roleName}`);
      }
    }),
);

integration(
  "a lock acquired after client inspection fails boundedly before writes",
  async () =>
    database(async ({ client, options, Client, url }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      const other = new Client({ connectionString: url, password: "" });
      let opened = false;
      const locked = {
        async query(sql, ...args) {
          const result = await client.query(sql, ...args);
          if (!opened && sql.startsWith("SELECT pg_advisory_xact_lock")) {
            opened = true;
            await other.connect();
            await other.query("BEGIN");
            await other.query("LOCK TABLE users IN ACCESS EXCLUSIVE MODE");
          }
          return result;
        },
      };
      const before = await fingerprint(client),
        start = Date.now();
      try {
        await assert.rejects(
          revision.reviseSyntheticClassroom({
            ...options,
            client: locked,
            ...authority(preview),
          }),
          /lock/,
        );
      } finally {
        if (opened) {
          await other.query("ROLLBACK");
          await other.end();
        }
      }
      assert.ok(Date.now() - start < 7000);
      assert.deepEqual(await fingerprint(client), before);
    }),
);

integration(
  "microsecond timestamp drift is rejected without JavaScript Date truncation",
  async () =>
    database(async ({ client, receipt, options }) => {
      await client.query(
        "UPDATE requests SET created_at=created_at+interval '1 microsecond' WHERE id=$1",
        [receipt.ids.requests[0]],
      );
      const before = await fingerprint(client);
      await assert.rejects(
        revision.reviseSyntheticClassroom(options),
        /precise precondition/,
      );
      assert.deepEqual(await fingerprint(client), before);
    }),
);

integration(
  "read-only backup baseline export matches preview and reveals no private row content",
  async () =>
    database(async ({ client, receipt, options }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const baseline = await revision.readSyntheticRevisionBaseline({
        client,
        receipt,
      });
      await client.query("ROLLBACK");
      assert.equal(baseline.baselineDigest, preview.evidence.baselineDigest);
      assert.equal(baseline.fullRowDigests.users.count, 985);
      assert.ok(!JSON.stringify(baseline).includes("opaque-original-password"));
      assert.ok(!JSON.stringify(baseline).includes("Fresh QA"));
    }),
);

integration(
  "a role without stats privileges still detects another user connection",
  async () =>
    database(async ({ client, options, Client, url }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      const roleName = `limited_${process.pid}_${serial}`;
      await client.query(`CREATE ROLE ${roleName} LOGIN`);
      const roleUrl = new URL(url);
      roleUrl.username = roleName;
      const limited = new Client({
        connectionString: roleUrl.href,
        password: "",
      });
      await limited.connect();
      try {
        assert.equal(
          (
            await limited.query(
              "SELECT pg_has_role(current_user,'pg_read_all_stats','member') AS allowed",
            )
          ).rows[0].allowed,
          false,
        );
        await assert.rejects(
          revision.reviseSyntheticClassroom({
            ...options,
            client: limited,
            expectedTarget: { ...options.expectedTarget, user: roleName },
            ...authority(preview),
          }),
          /other.*client/,
        );
      } finally {
        await limited.end();
        await client.query(`DROP ROLE ${roleName}`);
      }
    }),
);

integration(
  "external writer observations are refreshed at both boundaries and failed refresh rolls back",
  async () =>
    database(async ({ client, options }) => {
      const preview = await revision.reviseSyntheticClassroom(options);
      const before = await fingerprint(client),
        phases = [];
      const a = authority(preview),
        read = a.refreshWriterEvidence;
      a.refreshWriterEvidence = async (args) => {
        phases.push(args.phase);
        if (args.phase === "precommit")
          throw new Error("external writer scope changed");
        return read(args);
      };
      await assert.rejects(
        revision.reviseSyntheticClassroom({ ...options, ...a }),
        /external writer scope changed/,
      );
      assert.deepEqual(phases, ["locked-prewrite", "precommit"]);
      assert.deepEqual(await fingerprint(client), before);
    }),
);

integration(
  "role membership drift invalidates the reviewed grants fingerprint",
  async () =>
    database(async ({ client, options }) => {
      const roleName = `grant_group_${process.pid}_${serial}`;
      await client.query(`CREATE ROLE ${roleName}`);
      try {
        const preview = await revision.reviseSyntheticClassroom(options);
        const currentRole =
          '"' + options.expectedTarget.user.replaceAll('"', '""') + '"';
        await client.query(`GRANT ${roleName} TO ${currentRole}`);
        const before = await fingerprint(client);
        await assert.rejects(
          revision.reviseSyntheticClassroom({
            ...options,
            ...authority(preview),
          }),
          /preview.*changed|digest/,
        );
        assert.deepEqual(await fingerprint(client), before);
      } finally {
        await client.query(`DROP ROLE ${roleName}`);
      }
    }),
);

integration(
  "UTC and non-UTC sessions share one preview digest and helper baseline",
  async () =>
    database(async ({ client, receipt, options }) => {
      await client.query("SET TIME ZONE 'UTC'");
      const utc = await revision.reviseSyntheticClassroom(options);
      await client.query("SET TIME ZONE 'America/Los_Angeles'");
      const local = await revision.reviseSyntheticClassroom(options);
      assert.equal(local.previewDigest, utc.previewDigest);
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const baseline = await revision.readSyntheticRevisionBaseline({
        client,
        receipt,
      });
      assert.equal(baseline.baselineDigest, utc.evidence.baselineDigest);
      assert.equal(
        (await client.query("SHOW transaction_read_only")).rows[0]
          .transaction_read_only,
        "on",
      );
      await client.query("ROLLBACK");
      assert.equal(
        (await client.query("SHOW TIME ZONE")).rows[0].TimeZone,
        "America/Los_Angeles",
      );
      const result = await revision.reviseSyntheticClassroom({
        ...options,
        ...authority(utc),
      });
      assert.equal(result.operation, "revised");
      assert.equal(
        (await client.query("SHOW TIME ZONE")).rows[0].TimeZone,
        "America/Los_Angeles",
      );
    }),
);

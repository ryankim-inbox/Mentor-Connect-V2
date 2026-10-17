import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import pg from "pg";
import { runMigrationTransaction } from "../tools/migration-runner.mjs";
import { verifySchemaAssets } from "../tools/schema-assets.mjs";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const execFile = promisify(execFileCallback);
const seed = await import("../../../ops/seed-synthetic-classroom.mjs").catch(
  (error) => {
    if (error.code !== "ERR_MODULE_NOT_FOUND") throw error;
    return {};
  },
);
const integration = process.env.TEST_SYNTHETIC_DATABASE_URL ? test : test.skip;
const asOf = new Date(Date.now() - 60_000).toISOString();

test("exports a deterministic synthetic seed instead of invoking register or email", () => {
  assert.equal(typeof seed.seedSyntheticClassroom, "function");
  assert.equal(typeof seed.buildSyntheticPlan, "function");
});

test("seed connections require explicit certificate verification outside loopback", () => {
  const options = { allowedHost: "seed-test.invalid", databaseName: "neondb" };
  for (const suffix of [
    "",
    "?sslmode=disable",
    "?ssl=false",
    "?sslmode=require",
    "?sslmode=no-verify",
  ]) {
    assert.throws(
      () =>
        seed.syntheticSeedConnection({
          ...options,
          databaseUrl: `postgresql://seed-test.invalid/neondb${suffix}`,
        }),
      /TLS/,
    );
  }
  const secure = seed.syntheticSeedConnection({
    ...options,
    databaseUrl: "postgresql://seed-test.invalid/neondb?sslmode=verify-full",
  });
  assert.equal(
    secure.createClient().connectionParameters.ssl.rejectUnauthorized,
    true,
  );
  assert.equal(
    seed.syntheticSeedConnection({
      databaseUrl: "postgresql://127.0.0.1/synthetic_exact",
      allowedHost: "127.0.0.1",
      databaseName: "synthetic_exact",
    }).env.PGSSLMODE,
    "disable",
  );
});

test("builds identical plans with valid chronology and separate synthetic identity markers", () => {
  const parameters = {
    asOf: "2026-10-17T12:00:00.000Z",
    trackingStartedAt: "2026-10-01T00:00:00.000Z",
    districts: [{ id: 7 }, { id: 2 }],
    tags: [
      { id: 9, name: "Math" },
      { id: 3, name: "Science" },
    ],
  };
  const plan = seed.buildSyntheticPlan(parameters);
  assert.deepEqual(plan, seed.buildSyntheticPlan(parameters));
  assert.equal(new Set(plan.users.map((u) => u.email)).size, 983);
  assert.ok(
    plan.users.every(
      (u) =>
        u.email.endsWith(".invalid") &&
        !u.is_verified &&
        !u.is_admin &&
        u.email_verified_at === null,
    ),
  );
  assert.deepEqual(
    Object.fromEntries(
      ["mentee", "mentor", "both"].map((role) => [
        role,
        plan.users.filter((u) => u.role === role).length,
      ]),
    ),
    { mentee: 600, mentor: 250, both: 133 },
  );
  for (const event of plan.request_events) {
    assert.ok(
      Date.parse(event.occurred_at) >= Date.parse(parameters.trackingStartedAt),
    );
    assert.ok(
      Date.parse(event.occurred_at) >= Date.parse(event.request_created_at),
    );
    assert.ok(Date.parse(event.occurred_at) <= Date.parse(parameters.asOf));
  }
  assert.throws(
    () => seed.buildSyntheticPlan({ ...parameters, asOf: "2026-10-17" }),
    /exact UTC/,
  );
  assert.throws(
    () =>
      seed.buildSyntheticPlan({
        ...parameters,
        trackingStartedAt: "2026-10-18T00:00:00.000Z",
      }),
    /tracking started/,
  );
  assert.throws(
    () => seed.buildSyntheticPlan({ ...parameters, districts: [] }),
    /districts and tags/,
  );
});

test("preserves PostgreSQL Date milliseconds at the tracking coverage boundary", () => {
  const trackingStartedAt = new Date("2026-10-17T12:00:00.999Z");
  const plan = seed.buildSyntheticPlan({
    asOf: "2026-10-17T12:00:01.000Z",
    trackingStartedAt,
    districts: [{ id: 1 }],
    tags: [{ id: 1, name: "Math" }],
  });
  assert.ok(
    plan.request_events.every(
      (event) => Date.parse(event.occurred_at) >= trackingStartedAt.getTime(),
    ),
  );
});

async function database(name, callback, { version = 6 } = {}) {
  const admin = new pg.Client({
    connectionString: process.env.TEST_SYNTHETIC_DATABASE_URL,
  });
  await admin.connect();
  const databaseName = `synthetic_${name}`;
  await admin.query(`CREATE DATABASE ${databaseName}`);
  const url = new URL(process.env.TEST_SYNTHETIC_DATABASE_URL);
  url.pathname = "/" + databaseName;
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    const { ledger } = await verifySchemaAssets({ rootDir: root });
    await runMigrationTransaction({
      client,
      ledger: { ...ledger, migrations: ledger.migrations.slice(0, version) },
      appSha: "a".repeat(40),
    });
    await client.query(
      await readFile(
        path.join(root, "database/fixtures/classroom.sql"),
        "utf8",
      ),
    );
    await client.query(
      "UPDATE request_events SET occurred_at=$1::timestamptz-interval '90 days' WHERE kind='tracking_started'",
      [asOf],
    );
    await callback(client, url.href);
  } finally {
    await client.end();
    await admin.query(`DROP DATABASE ${databaseName} WITH (FORCE)`);
    await admin.end();
  }
}

async function population(client) {
  const result = {};
  for (const table of [
    "users",
    "questions",
    "requests",
    "schedules",
    "request_tags",
    "request_applications",
    "request_comments",
    "request_events",
    "reports",
    "email_verification_tokens",
    "email_verification_requests",
  ]) {
    result[table] = Number(
      (await client.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n,
    );
  }
  return result;
}

integration(
  "adds exact relational counts, leaves existing content intact, and reruns without writes",
  async () => {
    await database("exact", async (client, url) => {
      await client.query(
        "INSERT INTO users (email,name,password_hash,role,district_id,is_verified,email_verified_at,is_admin) VALUES ('fixture-admin@preserved.invalid','Preserved admin','unrelated-fixture','mentor',1,true,$1,true)",
        [asOf],
      );
      await client.query(
        "INSERT INTO requests (author_id,district_id,title,description,role) VALUES (1,1,'Preserved request','Preserved description','mentor')",
      );
      const before = (
        await client.query(
          "SELECT to_jsonb(u) AS value FROM users u WHERE id=1",
        )
      ).rows[0].value;
      const first = await seed.seedSyntheticClassroom({
        client,
        asOf,
        apply: true,
      });
      assert.equal(first.operation, "inserted");
      assert.deepEqual(first.counts, {
        users: 983,
        questions: 782,
        requests: 782,
        schedules: 1966,
        request_tags: 782,
        request_applications: 782,
        request_comments: 391,
        request_events: 312,
      });
      assert.deepEqual(await population(client), {
        users: 984,
        questions: 782,
        requests: 783,
        schedules: 1966,
        request_tags: 782,
        request_applications: 782,
        request_comments: 391,
        request_events: 313,
        reports: 0,
        email_verification_tokens: 0,
        email_verification_requests: 0,
      });
      assert.deepEqual(
        (
          await client.query(
            "SELECT to_jsonb(u) AS value FROM users u WHERE id=1",
          )
        ).rows[0].value,
        before,
      );
      assert.deepEqual(
        (
          await client.query(
            "SELECT title,description FROM requests WHERE id=1",
          )
        ).rows[0],
        { title: "Preserved request", description: "Preserved description" },
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM users WHERE id<>1 AND (is_verified OR email_verified_at IS NOT NULL OR is_admin OR password_hash<>$1)",
            [seed.SYNTHETIC_PASSWORD_LOCK],
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM request_applications a JOIN requests r ON r.id=a.request_id WHERE a.applicant_id=1 OR r.author_id=1",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM request_comments WHERE author_id=1",
          )
        ).rows[0].n,
        0,
      );
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM request_events WHERE kind='matched' AND (mentor_id=1 OR request_id=1 OR occurred_at<request_created_at)",
          )
        ).rows[0].n,
        0,
      );
      const snapshots = {};
      for (const table of Object.keys(first.counts))
        snapshots[table] = (
          await client.query(
            `SELECT jsonb_agg(t ORDER BY id) AS rows FROM ${table} t`,
          )
        ).rows[0].rows;
      const second = await seed.seedSyntheticClassroom({
        client,
        asOf,
        apply: true,
      });
      assert.equal(second.operation, "already-present");
      assert.equal(second.planDigest, first.planDigest);
      assert.deepEqual(second.ids, first.ids);
      for (const table of Object.keys(first.counts))
        assert.deepEqual(
          (
            await client.query(
              `SELECT jsonb_agg(t ORDER BY id) AS rows FROM ${table} t`,
            )
          ).rows[0].rows,
          snapshots[table],
        );
      if (process.env.SYNTHETIC_TEST_PYTHON) {
        const result = await execFile(
          process.env.SYNTHETIC_TEST_PYTHON,
          [
            "-B",
            path.join(root, "tests/support/synthetic-seed-api-check.py"),
            url,
          ],
          {
            env: { ...process.env, PYTHON_DOTENV_DISABLED: "1" },
            maxBuffer: 2_000_000,
          },
        );
        assert.equal(
          JSON.parse(result.stdout).ok,
          true,
          result.stdout + result.stderr,
        );
        console.info("Independent SQL/API evidence:", result.stdout.trim());
        assert.deepEqual(
          (
            await client.query(
              "SELECT to_jsonb(u) AS value FROM users u WHERE id=1",
            )
          ).rows[0].value,
          before,
        );
      }
    });
  },
);

integration("preview performs no inserts or sequence allocation", async () => {
  await database("preview", async (client) => {
    const sequences = (
      await client.query(
        "SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
      )
    ).rows;
    const before = await population(client);
    const result = await seed.seedSyntheticClassroom({ client, asOf });
    assert.equal(result.operation, "planned");
    assert.equal(result.counts.users, 983);
    assert.deepEqual(await population(client), before);
    assert.deepEqual(
      (
        await client.query(
          "SELECT sequencename,last_value FROM pg_sequences WHERE schemaname='public' ORDER BY sequencename",
        )
      ).rows,
      sequences,
    );
  });
});

integration(
  "rejects partial namespace conflicts atomically without overwriting content",
  async () => {
    await database("partial", async (client) => {
      await client.query(
        "INSERT INTO users (email,name,password_hash,role,district_id) VALUES ($1,'Preserved conflict','not-a-seed','mentee',1)",
        [`student-0001@${seed.SYNTHETIC_BATCH}.invalid`],
      );
      const before = await population(client);
      await assert.rejects(
        seed.seedSyntheticClassroom({ client, asOf, apply: true }),
        /conflict|incomplete/,
      );
      assert.deepEqual(await population(client), before);
      assert.equal(
        (await client.query("SELECT name FROM users")).rows[0].name,
        "Preserved conflict",
      );
    });
  },
);

integration(
  "rolls back all inserted relations when a later insert fails",
  async () => {
    await database("rollback", async (client) => {
      await client.query(
        "CREATE FUNCTION reject_synthetic_comment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected comment rejection'; END $$; CREATE TRIGGER reject_synthetic_comment BEFORE INSERT ON request_comments FOR EACH ROW EXECUTE FUNCTION reject_synthetic_comment()",
      );
      const before = await population(client);
      await assert.rejects(
        seed.seedSyntheticClassroom({ client, asOf, apply: true }),
        /injected comment rejection/,
      );
      assert.deepEqual(await population(client), before);
    });
  },
);

integration(
  "rejects drift or a different anchor rather than adding a second batch",
  async () => {
    await database("drift", async (client) => {
      await seed.seedSyntheticClassroom({ client, asOf, apply: true });
      const before = await population(client);
      await assert.rejects(
        seed.seedSyntheticClassroom({
          client,
          asOf: new Date(Date.parse(asOf) - 1000).toISOString(),
          apply: true,
        }),
        /conflict|differs/,
      );
      await client.query(
        "UPDATE requests SET title='Preserved later edit' WHERE id=1",
      );
      await assert.rejects(
        seed.seedSyntheticClassroom({ client, asOf, apply: true }),
        /conflict|differs/,
      );
      assert.deepEqual(await population(client), before);
      assert.equal(
        (await client.query("SELECT title FROM requests WHERE id=1")).rows[0]
          .title,
        "Preserved later edit",
      );
    });
  },
);

integration(
  "keeps events after a PostgreSQL tracking marker with microseconds",
  async () => {
    await database("microseconds", async (client) => {
      await client.query(
        "UPDATE request_events SET occurred_at=$1::timestamptz-interval '0.5 milliseconds' WHERE kind='tracking_started'",
        [asOf],
      );
      await seed.seedSyntheticClassroom({ client, asOf, apply: true });
      assert.equal(
        (
          await client.query(
            "SELECT count(*)::int AS n FROM request_events e WHERE kind='matched' AND occurred_at<(SELECT occurred_at FROM request_events WHERE kind='tracking_started')",
          )
        ).rows[0].n,
        0,
      );
    });
  },
);

integration("fails before any write when schema 0006 is missing", async () => {
  await database(
    "old_schema",
    async (client) => {
      await assert.rejects(
        seed.seedSyntheticClassroom({ client, asOf, apply: true }),
        /migration 0006/,
      );
      assert.equal(
        (await client.query("SELECT count(*)::int AS n FROM users")).rows[0].n,
        0,
      );
    },
    { version: 5 },
  );
});

integration(
  "rejects unidentified match history after a partial batch cleanup",
  async () => {
    await database("orphaned_history", async (client) => {
      await seed.seedSyntheticClassroom({ client, asOf, apply: true });
      await client.query(
        "DELETE FROM requests WHERE request LIKE 'mc-synthetic-v1-983-782:question:%'",
      );
      await client.query("DELETE FROM users WHERE password_hash=$1", [
        seed.SYNTHETIC_PASSWORD_LOCK,
      ]);
      const before = await population(client);
      assert.equal(before.users, 0);
      assert.equal(before.request_events, 313);
      await assert.rejects(
        seed.seedSyntheticClassroom({ client, asOf, apply: true }),
        /unidentifiable match history/,
      );
      assert.deepEqual(await population(client), before);
    });
  },
);

integration(
  "serializes concurrent runs into one insertion and one exact rerun",
  async () => {
    await database("concurrent", async (client, url) => {
      const second = new pg.Client({ connectionString: url });
      await second.connect();
      try {
        const results = await Promise.all([
          seed.seedSyntheticClassroom({ client, asOf, apply: true }),
          seed.seedSyntheticClassroom({ client: second, asOf, apply: true }),
        ]);
        assert.deepEqual(results.map((r) => r.operation).sort(), [
          "already-present",
          "inserted",
        ]);
        assert.equal(results[0].planDigest, results[1].planDigest);
        assert.deepEqual(results[0].ids, results[1].ids);
        assert.equal((await population(client)).users, 983);
      } finally {
        await second.end();
      }
    });
  },
);

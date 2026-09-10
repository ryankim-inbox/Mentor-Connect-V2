import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import pg from "pg";

import { runMigrationTransaction } from "../tools/migration-runner.mjs";
import { verifySchemaAssets } from "../tools/schema-assets.mjs";

const execFile = promisify(execFileCallback);
const rootDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const bootstrapPath = path.join(rootDir, "ops/bootstrap-classroom.mjs");
const schemaCliPath = path.join(rootDir, "lib/db/tools/schema-cli.mjs");
const { bootstrapClassroom, validateClassroomTarget } = await import(
  new URL("../../../ops/bootstrap-classroom.mjs", import.meta.url)
);
const { seedClassroom } = await import(
  new URL("../../../ops/seed-classroom.mjs", import.meta.url)
);
const { Client } = pg;
const integrationTest = process.env.TEST_CLASSROOM_EMPTY_URL ? test : test.skip;
const realApiTest = process.env.TEST_CLASSROOM_REAL_ORIGIN ? test : test.skip;

async function requestJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

async function startClassroomApi(
  databaseUrl,
  { persistRegistrations = true, registrationFailure = false } = {},
) {
  const apiClient = new Client({ connectionString: databaseUrl });
  await apiClient.connect();
  const calls = [];
  let syntheticId = 5000;
  const server = createServer(async (request, response) => {
    try {
      const body = await requestJson(request);
      calls.push({
        method: request.method,
        url: request.url,
        origin: request.headers.origin,
        cookie: request.headers.cookie,
        body,
      });
      if (request.method === "POST" && request.url === "/api/auth/register") {
        if (registrationFailure) {
          response.writeHead(422, {
            "content-type": "application/json",
            "x-request-id": "failure-42",
          });
          response.end(
            JSON.stringify({ detail: "do-not-log-this-raw-response" }),
          );
          return;
        }
        const user = persistRegistrations
          ? (
              await apiClient.query(
                `INSERT INTO users
                   (email, name, password_hash, role, district_id, is_verified)
                 VALUES ($1, $2, $3, $4, $5, true)
                 RETURNING id, email, name, role, district_id AS "districtId",
                           is_verified AS "isVerified", created_at AS "createdAt", subjects`,
                [
                  body.email,
                  body.name,
                  "test-only-hash",
                  body.role,
                  body.districtId,
                ],
              )
            ).rows[0]
          : {
              id: (syntheticId += 1),
              email: body.email,
              name: body.name,
              role: body.role,
              districtId: body.districtId,
              isVerified: true,
              createdAt: new Date().toISOString(),
              subjects: [],
            };
        response.writeHead(201, {
          "content-type": "application/json",
          "set-cookie": [
            "classroom_notice=seen; Path=/",
            `peerbridge_session=user-${user.id}; HttpOnly; Path=/; SameSite=lax`,
          ],
          "x-request-id": `register-${user.id}`,
        });
        response.end(
          JSON.stringify({
            user,
            message: "Registered successfully",
          }),
        );
        return;
      }
      const profileMatch = /^\/api\/users\/(\d+)$/.exec(request.url ?? "");
      if (request.method === "PATCH" && profileMatch) {
        const id = Number(profileMatch[1]);
        if (request.headers.cookie !== `peerbridge_session=user-${id}`) {
          response.writeHead(401, { "x-request-id": "profile-cookie" });
          response.end();
          return;
        }
        const updated = await apiClient.query(
          `UPDATE users SET subjects = $1 WHERE id = $2
           RETURNING id, email, name, role, district_id AS "districtId",
                     is_verified AS "isVerified", created_at AS "createdAt", subjects`,
          [body.subjects, id],
        );
        response.writeHead(200, {
          "content-type": "application/json",
          "x-request-id": "profile-update",
        });
        response.end(JSON.stringify(updated.rows[0]));
        return;
      }
      response.writeHead(404, { "x-request-id": "unexpected-route" });
      response.end();
    } catch {
      response.writeHead(500, { "x-request-id": "fixture-failure" });
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    calls,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await apiClient.end();
    },
  };
}

const migrationSql = "SELECT 1;\n";
const ledger = {
  advisoryLockKey: "774301992604150",
  ledgerTable: "mentor_connect_schema_migrations",
  migrations: [
    {
      ordinal: 1,
      sequence: 1,
      id: "0001_first",
      sha256: createHash("sha256").update(migrationSql).digest("hex"),
      sql: migrationSql,
    },
  ],
};

test("runner calls beforeApply after locking and before its first schema write", async () => {
  const events = [];
  const client = {
    async query(sql) {
      const normalized = sql.trim().replaceAll(/\s+/g, " ");
      events.push(normalized);
      if (normalized.startsWith("SELECT ordinal,")) return { rows: [] };
      return { rows: [] };
    },
  };

  await runMigrationTransaction({
    client,
    ledger,
    appSha: "a".repeat(40),
    beforeApply() {
      events.push("beforeApply");
    },
  });

  const lockIndex = events.findIndex((event) =>
    event.startsWith("SELECT pg_advisory_xact_lock"),
  );
  const callbackIndex = events.indexOf("beforeApply");
  const firstWriteIndex = events.findIndex(
    (event) =>
      event.startsWith("CREATE TABLE") || event === migrationSql.trim(),
  );
  assert.ok(lockIndex >= 0);
  assert.ok(callbackIndex > lockIndex);
  assert.ok(firstWriteIndex > callbackIndex);
});

test("bootstrap rejects connection options that can redirect the target before connecting", async () => {
  const cases = [
    [
      "postgresql://wrong.invalid/classroom",
      /classroom database target mismatch/,
    ],
    [
      "postgresql://allowed.invalid/wrong_database",
      /classroom database target mismatch/,
    ],
    [
      "postgresql://allowed.invalid/classroom?host=127.0.0.1",
      /unsupported classroom database URL option: host/,
    ],
    [
      "postgresql://allowed.invalid/classroom?database=wrong_database",
      /unsupported classroom database URL option: database/,
    ],
    [
      "postgresql://allowed.invalid/classroom?user=other_user",
      /unsupported classroom database URL option: user/,
    ],
    [
      "postgresql://allowed.invalid/classroom?application_name=bootstrap",
      /unsupported classroom database URL option: application_name/,
    ],
  ];
  for (const [databaseUrl, expected] of cases) {
    await assert.rejects(
      execFile(process.execPath, [bootstrapPath], {
        cwd: rootDir,
        env: {
          ...process.env,
          CLASSROOM_DATABASE_URL: databaseUrl,
          CLASSROOM_ALLOWED_HOST: "allowed.invalid",
          CLASSROOM_DATABASE_NAME: "classroom",
          CLASSROOM_APP_SHA: "b".repeat(40),
        },
      }),
      (error) =>
        error.code === 1 &&
        expected.test(error.stderr) &&
        !/ECONNREFUSED|getaddrinfo/.test(error.stderr),
    );
  }
});

test("classroom target validation retains supported provider TLS options", () => {
  assert.deepEqual(
    validateClassroomTarget({
      databaseUrl: "postgresql://allowed.invalid/classroom?sslmode=verify-full",
      allowedHost: "allowed.invalid",
      databaseName: "classroom",
    }),
    {
      databaseUrl: "postgresql://allowed.invalid/classroom?sslmode=verify-full",
      hostname: "allowed.invalid",
      databaseName: "classroom",
    },
  );
});

test("classroom target validation matches the database name parsed by pg for reserved encodings", () => {
  const cases = [
    ["classroom%3Farchive", "classroom?archive"],
    ["classroom%23archive", "classroom#archive"],
    ["classroom%2Farchive", "classroom/archive"],
  ];
  for (const [effectiveDatabase, differentlyDecodedDatabase] of cases) {
    const databaseUrl = `postgresql://allowed.invalid/${effectiveDatabase}?sslmode=verify-full`;
    const probe = new Client({ connectionString: databaseUrl });
    assert.equal(probe.connectionParameters.database, effectiveDatabase);
    assert.throws(
      () =>
        validateClassroomTarget({
          databaseUrl,
          allowedHost: "allowed.invalid",
          databaseName: differentlyDecodedDatabase,
        }),
      /classroom database target mismatch/,
    );
    assert.equal(
      validateClassroomTarget({
        databaseUrl,
        allowedHost: "allowed.invalid",
        databaseName: effectiveDatabase,
      }).databaseName,
      probe.connectionParameters.database,
    );
  }
});

test("classroom target validation returns the exact URL consumed by pg after canonicalizing raw spaces", () => {
  const canonical = new URL("postgresql://allowed.invalid/classroom%2Darchive");
  canonical.username = "operator";
  canonical.password = "synthetic classroom password";
  const rawDatabaseUrl = canonical.href.replace(
    canonical.password,
    "synthetic classroom password",
  );
  const rawProbe = new Client({ connectionString: rawDatabaseUrl });
  assert.equal(rawProbe.connectionParameters.database, "classroom%2Darchive");

  const target = validateClassroomTarget({
    databaseUrl: rawDatabaseUrl,
    allowedHost: "allowed.invalid",
    databaseName: "classroom-archive",
  });
  assert.equal(target.hostname, "allowed.invalid");
  assert.equal(target.databaseName, "classroom-archive");
  assert.equal(target.databaseUrl, canonical.href);

  const consumed = new Client({ connectionString: target.databaseUrl });
  assert.equal(consumed.connectionParameters.host, "allowed.invalid");
  assert.equal(consumed.connectionParameters.database, "classroom-archive");
});

integrationTest(
  "bootstrap applies schema 0001 and 0002 once and refuses a populated database",
  async () => {
    const { ledger } = await verifySchemaAssets({ rootDir });
    const client = new Client({
      connectionString: process.env.TEST_CLASSROOM_EMPTY_URL,
    });
    await client.connect();
    try {
      assert.deepEqual(
        await bootstrapClassroom({
          client,
          ledger,
          appSha: "c".repeat(40),
        }),
        {
          applied: [
            "0001_canonical_baseline",
            "0002_integrity_constraints_indexes",
          ],
          alreadyApplied: [],
        },
      );
      const firstLedger = await client.query(
        "SELECT migration_id FROM mentor_connect_schema_migrations ORDER BY ordinal",
      );
      assert.deepEqual(
        firstLedger.rows.map((row) => row.migration_id),
        ["0001_canonical_baseline", "0002_integrity_constraints_indexes"],
      );

      await assert.rejects(
        bootstrapClassroom({
          client,
          ledger,
          appSha: "d".repeat(40),
        }),
        /classroom bootstrap requires an empty database/,
      );
      const secondLedger = await client.query(
        "SELECT count(*)::integer AS count FROM mentor_connect_schema_migrations",
      );
      assert.equal(secondLedger.rows[0].count, 2);
    } finally {
      await client.end();
    }
  },
);

integrationTest(
  "seed API failures expose only status and a sanitized request id",
  async () => {
    const { ledger } = await verifySchemaAssets({ rootDir });
    const client = new Client({
      connectionString: process.env.TEST_CLASSROOM_FAILURE_URL,
    });
    await client.connect();
    const api = await startClassroomApi(
      process.env.TEST_CLASSROOM_FAILURE_URL,
      {
        registrationFailure: true,
      },
    );
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), "mentor-connect-classroom-api-failure-"),
    );
    const credentialFile = path.join(outputDirectory, "accounts.json");
    try {
      await bootstrapClassroom({
        client,
        ledger,
        appSha: "3".repeat(40),
      });
      let failure;
      try {
        await seedClassroom({
          client,
          origin: api.origin,
          credentialFile,
          rootDir,
        });
      } catch (error) {
        failure = error;
      }
      assert.equal(
        failure?.message,
        "classroom API POST failed with status 422 (request failure-42)",
      );
      assert.doesNotMatch(failure.message, /do-not-log-this-raw-response/);
      assert.doesNotMatch(
        failure.message,
        new RegExp(api.calls[0].body.password),
      );
      assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
      assert.equal((await stat(credentialFile)).size, 0);
    } finally {
      await api.close();
      await client.end();
      await rm(outputDirectory, { recursive: true, force: true });
    }
  },
);

realApiTest(
  "operator CLIs seed the existing Python API and its login, rooms, and matching paths can read the fixtures",
  async () => {
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), "mentor-connect-real-api-credentials-"),
    );
    const credentialFile = path.join(outputDirectory, "accounts.json");
    const environment = {
      ...process.env,
      CLASSROOM_DATABASE_URL: process.env.TEST_CLASSROOM_REAL_URL,
      CLASSROOM_ALLOWED_HOST: "127.0.0.1",
      CLASSROOM_DATABASE_NAME: "classroom_real",
      CLASSROOM_APP_SHA: "2".repeat(40),
      CLASSROOM_ORIGIN: process.env.TEST_CLASSROOM_REAL_ORIGIN,
      CLASSROOM_CREDENTIAL_FILE: credentialFile,
    };
    try {
      const bootstrapped = await execFile(process.execPath, [bootstrapPath], {
        cwd: rootDir,
        env: environment,
      });
      assert.deepEqual(JSON.parse(bootstrapped.stdout), {
        applied: [
          "0001_canonical_baseline",
          "0002_integrity_constraints_indexes",
        ],
        alreadyApplied: [],
      });
      await execFile(
        process.execPath,
        [path.join(rootDir, "ops/seed-classroom.mjs")],
        { cwd: rootDir, env: environment },
      );
      const credentials = JSON.parse(await readFile(credentialFile, "utf8"));
      const login = await fetch(
        new URL("/api/auth/login", process.env.TEST_CLASSROOM_REAL_ORIGIN),
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: process.env.TEST_CLASSROOM_REAL_ORIGIN,
          },
          body: JSON.stringify({
            email: credentials.accounts.mentee.email,
            password: credentials.accounts.mentee.password,
          }),
        },
      );
      assert.equal(login.status, 200);
      const loggedIn = await login.json();
      assert.equal(loggedIn.user.id, credentials.accounts.mentee.id);
      const cookie = login.headers
        .getSetCookie()
        .map((value) => value.split(";", 1)[0])
        .find((value) => value.startsWith("peerbridge_session="));
      assert.ok(cookie);

      const rooms = await fetch(
        new URL("/api/chat/rooms", process.env.TEST_CLASSROOM_REAL_ORIGIN),
        { headers: { cookie, origin: process.env.TEST_CLASSROOM_REAL_ORIGIN } },
      );
      assert.equal(rooms.status, 200);
      const roomPayload = await rooms.json();
      assert.ok(
        roomPayload.some(
          (room) => room.id === credentials.fixtures.globalRoomId,
        ),
      );

      const matching = await fetch(
        new URL(
          `/api/matches/${credentials.fixtures.questionId}`,
          process.env.TEST_CLASSROOM_REAL_ORIGIN,
        ),
        { headers: { cookie, origin: process.env.TEST_CLASSROOM_REAL_ORIGIN } },
      );
      assert.equal(matching.status, 200);
      const matchingPayload = await matching.json();
      assert.equal(
        matchingPayload.question_id,
        credentials.fixtures.questionId,
      );
      assert.equal(typeof matchingPayload.success, "boolean");
      if (!matchingPayload.success) {
        assert.equal(matchingPayload.feature, "matching");
        assert.equal(typeof matchingPayload.status, "string");
        assert.equal(Array.isArray(matchingPayload.matches), true);
      }
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  },
);

integrationTest(
  "seed uses the register API, preserves its cookie for mentor subjects, and writes exact 0600 credentials",
  async () => {
    const { ledger } = await verifySchemaAssets({ rootDir });
    const client = new Client({
      connectionString: process.env.TEST_CLASSROOM_SEED_URL,
    });
    await client.connect();
    const api = await startClassroomApi(process.env.TEST_CLASSROOM_SEED_URL);
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), "mentor-connect-classroom-credentials-"),
    );
    const credentialFile = path.join(outputDirectory, "accounts.json");
    try {
      await bootstrapClassroom({
        client,
        ledger,
        appSha: "f".repeat(40),
      });
      const result = await seedClassroom({
        client,
        origin: api.origin,
        credentialFile,
        rootDir,
      });
      const credentials = JSON.parse(await readFile(credentialFile, "utf8"));
      assert.deepEqual(credentials, result);
      assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
      assert.deepEqual(Object.keys(credentials), ["accounts", "fixtures"]);
      assert.deepEqual(Object.keys(credentials.accounts), ["mentor", "mentee"]);
      assert.deepEqual(Object.keys(credentials.fixtures), [
        "questionId",
        "globalRoomId",
        "districtIds",
      ]);
      assert.equal(
        credentials.accounts.mentor.email,
        "mentor@classroom.example.edu",
      );
      assert.equal(
        credentials.accounts.mentee.email,
        "mentee@classroom.example.edu",
      );
      assert.match(credentials.accounts.mentor.password, /^[A-Za-z0-9_-]{32}$/);
      assert.match(credentials.accounts.mentee.password, /^[A-Za-z0-9_-]{32}$/);
      assert.notEqual(
        credentials.accounts.mentor.password,
        credentials.accounts.mentee.password,
      );

      const fixtureRows = await client.query(
        `
        SELECT
          (SELECT json_agg(name ORDER BY id) FROM districts) AS districts,
          (SELECT json_agg(name ORDER BY id) FROM tags) AS tags,
          (SELECT json_agg(name ORDER BY id) FROM chat_rooms) AS rooms,
          (SELECT json_build_object(
             'studentId', student_id,
             'subject', subject,
             'topic', topic,
             'message', message
           ) FROM questions WHERE id = $1) AS question,
          (SELECT subjects FROM users WHERE id = $2) AS mentor_subjects
      `,
        [credentials.fixtures.questionId, credentials.accounts.mentor.id],
      );
      assert.deepEqual(fixtureRows.rows[0], {
        districts: ["Classroom North", "Classroom South"],
        tags: ["Math", "Science"],
        rooms: [
          "Classroom Lounge",
          "Classroom North Chat",
          "Classroom South Chat",
        ],
        question: {
          studentId: credentials.accounts.mentee.id,
          subject: "Math",
          topic: "Algebra",
          message: "Classroom practice question",
        },
        mentor_subjects: ["Math"],
      });
      assert.equal(api.calls.length, 3);
      assert.equal(api.calls[0].origin, api.origin);
      assert.equal(api.calls[1].origin, api.origin);
      assert.equal(
        api.calls[1].cookie,
        `peerbridge_session=user-${credentials.accounts.mentor.id}`,
      );
      assert.deepEqual(api.calls[1].body, { subjects: ["Math"] });
      assert.equal(api.calls[2].origin, api.origin);

      const inspectionEnvironment = {
        ...process.env,
        DATABASE_URL: process.env.TEST_CLASSROOM_SEED_URL,
        MIGRATION_ALLOWED_HOSTS_STAGING: "127.0.0.1",
      };
      const schemaCheck = await execFile(
        process.execPath,
        [schemaCliPath, "schema:check"],
        { cwd: rootDir, env: inspectionEnvironment },
      );
      assert.match(schemaCheck.stdout, /schema check: ok \(version 0002/);
      const schemaDiff = await execFile(
        process.execPath,
        [schemaCliPath, "schema:diff", "--", "--read-only"],
        { cwd: rootDir, env: inspectionEnvironment },
      );
      assert.match(schemaDiff.stdout, /schema diff: 0 \(read-only\)/);
      const constraints = await execFile(
        process.execPath,
        [schemaCliPath, "constraints:verify", "--", "--env", "staging"],
        { cwd: rootDir, env: inspectionEnvironment },
      );
      assert.match(
        constraints.stdout,
        /constraint differences 0 \(read-only\)/,
      );

      const secondCredentialFile = path.join(outputDirectory, "second.json");
      await assert.rejects(
        seedClassroom({
          client,
          origin: api.origin,
          credentialFile: secondCredentialFile,
          rootDir,
        }),
        /classroom seed requires an unseeded database/,
      );
      assert.equal(api.calls.length, 3);
      await assert.rejects(stat(secondCredentialFile), { code: "ENOENT" });
    } finally {
      await api.close();
      await client.end();
      await rm(outputDirectory, { recursive: true, force: true });
    }
  },
);

integrationTest(
  "seed reserves its credential output before API calls and refuses a response from another database",
  async () => {
    const { ledger } = await verifySchemaAssets({ rootDir });
    const client = new Client({
      connectionString: process.env.TEST_CLASSROOM_MISMATCH_URL,
    });
    await client.connect();
    const api = await startClassroomApi(
      process.env.TEST_CLASSROOM_MISMATCH_URL,
      {
        persistRegistrations: false,
      },
    );
    const outputDirectory = await mkdtemp(
      path.join(tmpdir(), "mentor-connect-classroom-guard-"),
    );
    const credentialFile = path.join(outputDirectory, "accounts.json");
    try {
      await bootstrapClassroom({
        client,
        ledger,
        appSha: "1".repeat(40),
      });
      const occupied = await open(credentialFile, "wx", 0o600);
      await occupied.close();
      await assert.rejects(
        seedClassroom({
          client,
          origin: api.origin,
          credentialFile,
          rootDir,
        }),
        (error) => error.code === "EEXIST",
      );
      assert.equal(api.calls.length, 0);
      assert.equal(
        (await client.query("SELECT count(*)::integer AS count FROM districts"))
          .rows[0].count,
        0,
      );

      await rm(credentialFile);
      await assert.rejects(
        seedClassroom({
          client,
          origin: api.origin,
          credentialFile,
          rootDir,
        }),
        /register response does not match the selected database/,
      );
      assert.equal(api.calls.length, 1);
      assert.equal((await stat(credentialFile)).mode & 0o777, 0o600);
      assert.equal((await stat(credentialFile)).size, 0);
      const partial = await client.query(`
        SELECT
          (SELECT count(*)::integer FROM districts) AS districts,
          (SELECT count(*)::integer FROM users) AS users,
          (SELECT count(*)::integer FROM questions) AS questions
      `);
      assert.deepEqual(partial.rows[0], {
        districts: 2,
        users: 0,
        questions: 0,
      });

      await assert.rejects(
        seedClassroom({
          client,
          origin: api.origin,
          credentialFile: path.join(outputDirectory, "retry.json"),
          rootDir,
        }),
        /classroom seed requires an unseeded database/,
      );
      assert.equal(api.calls.length, 1);
    } finally {
      await api.close();
      await client.end();
      await rm(outputDirectory, { recursive: true, force: true });
    }
  },
);

integrationTest(
  "bootstrap refuses an application table without creating a migration ledger",
  async () => {
    const { ledger } = await verifySchemaAssets({ rootDir });
    const client = new Client({
      connectionString: process.env.TEST_CLASSROOM_POPULATED_URL,
    });
    await client.connect();
    try {
      await client.query(
        "CREATE TABLE preexisting_application_data (id integer)",
      );
      await assert.rejects(
        bootstrapClassroom({
          client,
          ledger,
          appSha: "e".repeat(40),
        }),
        /classroom bootstrap requires an empty database/,
      );
      const relations = await client.query(`
        SELECT
          to_regclass('public.preexisting_application_data') AS application,
          to_regclass('public.mentor_connect_schema_migrations') AS ledger
      `);
      assert.equal(
        relations.rows[0].application,
        "preexisting_application_data",
      );
      assert.equal(relations.rows[0].ledger, null);
    } finally {
      await client.end();
    }
  },
);

integrationTest(
  "bootstrap refuses non-public tables, public sequences, and public materialized views without writing a ledger",
  async () => {
    const { ledger } = await verifySchemaAssets({ rootDir });
    const cases = [
      {
        databaseUrl: process.env.TEST_CLASSROOM_OTHER_SCHEMA_URL,
        setup:
          "CREATE SCHEMA classroom_existing; CREATE TABLE classroom_existing.records (id integer)",
        relation: "classroom_existing.records",
      },
      {
        databaseUrl: process.env.TEST_CLASSROOM_SEQUENCE_URL,
        setup: "CREATE SEQUENCE public.classroom_existing_sequence",
        relation: "public.classroom_existing_sequence",
      },
      {
        databaseUrl: process.env.TEST_CLASSROOM_MATERIALIZED_VIEW_URL,
        setup:
          "CREATE MATERIALIZED VIEW public.classroom_existing_summary AS SELECT 1 AS value",
        relation: "public.classroom_existing_summary",
      },
    ];
    for (const item of cases) {
      const client = new Client({ connectionString: item.databaseUrl });
      await client.connect();
      try {
        await client.query(item.setup);
        await assert.rejects(
          bootstrapClassroom({
            client,
            ledger,
            appSha: "4".repeat(40),
          }),
          /classroom bootstrap requires an empty database/,
        );
        const relations = await client.query(
          `SELECT
             to_regclass($1) AS existing,
             to_regclass('public.mentor_connect_schema_migrations') AS ledger`,
          [item.relation],
        );
        assert.ok(relations.rows[0].existing);
        assert.equal(relations.rows[0].ledger, null);
      } finally {
        await client.end();
      }
    }
  },
);

integrationTest(
  "concurrent bootstrap attempts apply exactly once under the advisory lock",
  async () => {
    const { ledger } = await verifySchemaAssets({ rootDir });
    const clients = [
      new Client({
        connectionString: process.env.TEST_CLASSROOM_CONCURRENT_URL,
      }),
      new Client({
        connectionString: process.env.TEST_CLASSROOM_CONCURRENT_URL,
      }),
    ];
    await Promise.all(clients.map((client) => client.connect()));
    try {
      const results = await Promise.allSettled(
        clients.map((client, index) =>
          bootstrapClassroom({
            client,
            ledger,
            appSha: String(index + 1).repeat(40),
          }),
        ),
      );
      assert.equal(
        results.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        results.filter(
          (result) =>
            result.status === "rejected" &&
            /classroom bootstrap requires an empty database/.test(
              result.reason.message,
            ),
        ).length,
        1,
      );
      const applied = await clients[0].query(
        "SELECT count(*)::integer AS count FROM mentor_connect_schema_migrations",
      );
      assert.equal(applied.rows[0].count, 2);
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }
  },
);

import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createGatewayServer } from "../src/gateway.ts";
import { createReadinessChecker } from "../src/readiness.ts";
import { writeReleaseMetadata } from "../../../scripts/write-release-metadata.mjs";

const migrationId = "0002_integrity_constraints_indexes";
const publicOrigin = "http://127.0.0.1:14200";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

function healthyResponse(): Response {
  return Response.json({ status: "ok", backend: "python-fastapi" });
}

function successfulPool() {
  const queries: string[] = [];
  const releases: Array<boolean | undefined> = [];
  let ended = false;

  return {
    queries,
    releases,
    get ended() {
      return ended;
    },
    pool: {
      async connect() {
        return {
          async query(sql: string) {
            queries.push(sql);
            return sql.includes("migration_id")
              ? { rows: [{ migrationId }] }
              : { rows: [] };
          },
          release(destroy?: boolean) {
            releases.push(destroy);
          },
        };
      },
      async end() {
        ended = true;
      },
    },
  };
}

test("checks only Python health and the read-only database ledger tail", async () => {
  const database = successfulPool();
  const fetchTargets: string[] = [];
  let poolOptions: Record<string, unknown> | undefined;
  const checker = createReadinessChecker({
    upstreamOrigin: "http://127.0.0.1:8181",
    databaseUrl: "postgresql://readiness@127.0.0.1/classroom",
    expectedMigrationId: migrationId,
    fetchImplementation: async (input) => {
      fetchTargets.push(String(input));
      return healthyResponse();
    },
    poolFactory(options) {
      poolOptions = options;
      return database.pool;
    },
  });

  assert.equal(await checker.checkReadiness(), true);
  assert.deepEqual(fetchTargets, ["http://127.0.0.1:8181/api/healthz"]);
  assert.deepEqual(poolOptions, {
    connectionString: "postgresql://readiness@127.0.0.1/classroom",
    connectionTimeoutMillis: 1_000,
    max: 1,
    statement_timeout: 1_000,
  });
  assert.deepEqual(database.queries, [
    "BEGIN READ ONLY",
    "SELECT 1",
    'SELECT migration_id AS "migrationId" FROM public.mentor_connect_schema_migrations ORDER BY ordinal DESC LIMIT 1',
    "ROLLBACK",
  ]);
  assert.deepEqual(database.releases, [undefined]);
});

test("returns false without using ambient credentials when the credential is omitted", async () => {
  let poolsCreated = 0;
  const originalCredential = process.env.READINESS_DATABASE_URL;
  process.env.READINESS_DATABASE_URL =
    "postgresql://ambient-must-not-be-used@127.0.0.1/classroom";
  const checker = createReadinessChecker({
    databaseUrl: undefined,
    expectedMigrationId: migrationId,
    fetchImplementation: async () => healthyResponse(),
    poolFactory() {
      poolsCreated += 1;
      return successfulPool().pool;
    },
  });
  if (originalCredential === undefined)
    delete process.env.READINESS_DATABASE_URL;
  else process.env.READINESS_DATABASE_URL = originalCredential;

  assert.equal(await checker.checkReadiness(), false);
  assert.equal(poolsCreated, 0);
});

test("turns a synchronous database configuration failure into not ready", async () => {
  const checker = createReadinessChecker({
    databaseUrl: "not-a-postgresql-url",
    expectedMigrationId: migrationId,
    fetchImplementation: async () => healthyResponse(),
    poolFactory() {
      throw new Error("database configuration detail");
    },
  });

  await assert.doesNotReject(async () => {
    assert.equal(await checker.checkReadiness(), false);
  });
});

test("returns false and rolls back when a database check fails", async () => {
  const queries: string[] = [];
  const releases: Array<boolean | undefined> = [];
  const checker = createReadinessChecker({
    databaseUrl: "postgresql://readiness@127.0.0.1/classroom",
    expectedMigrationId: migrationId,
    fetchImplementation: async () => healthyResponse(),
    poolFactory: () => ({
      async connect() {
        return {
          async query(sql: string) {
            queries.push(sql);
            if (sql === "SELECT 1") throw new Error("secret database detail");
            return { rows: [] };
          },
          release(destroy?: boolean) {
            releases.push(destroy);
          },
        };
      },
      async end() {},
    }),
  });

  assert.equal(await checker.checkReadiness(), false);
  assert.deepEqual(queries, ["BEGIN READ ONLY", "SELECT 1", "ROLLBACK"]);
  assert.deepEqual(releases, [undefined]);
});

test("does not treat failed database and metadata checks as matching tails", async () => {
  const checker = createReadinessChecker({
    databaseUrl: "postgresql://readiness@127.0.0.1/classroom",
    releaseMetadataUrl: new URL(
      `file://${path.join(tmpdir(), `missing-release-${process.pid}.json`)}`,
    ),
    fetchImplementation: async () => healthyResponse(),
    poolFactory: () => ({
      async connect() {
        throw new Error("database unavailable");
      },
      async end() {},
    }),
  });

  assert.equal(await checker.checkReadiness(), false);
});

test("returns false when Python health is unavailable", async () => {
  const database = successfulPool();
  const checker = createReadinessChecker({
    databaseUrl: "postgresql://readiness@127.0.0.1/classroom",
    expectedMigrationId: migrationId,
    fetchImplementation: async () =>
      new Response("unavailable", { status: 503 }),
    poolFactory: () => database.pool,
  });

  assert.equal(await checker.checkReadiness(), false);
  assert.deepEqual(database.releases, [undefined]);
});

test("shares an in-flight probe and caches its result for two seconds", async () => {
  const database = successfulPool();
  let now = 0;
  let fetchCalls = 0;
  let finishFetch: ((response: Response) => void) | undefined;
  const firstFetch = new Promise<Response>((resolve) => {
    finishFetch = resolve;
  });
  const checker = createReadinessChecker({
    databaseUrl: "postgresql://readiness@127.0.0.1/classroom",
    expectedMigrationId: migrationId,
    now: () => now,
    fetchImplementation: async () => {
      fetchCalls += 1;
      return fetchCalls === 1 ? firstFetch : healthyResponse();
    },
    poolFactory: () => database.pool,
  });

  const first = checker.checkReadiness();
  const concurrent = checker.checkReadiness();
  assert.equal(first, concurrent);
  finishFetch?.(healthyResponse());
  assert.equal(await first, true);

  now = 1_999;
  assert.equal(await checker.checkReadiness(), true);
  assert.equal(fetchCalls, 1);

  now = 2_000;
  assert.equal(await checker.checkReadiness(), true);
  assert.equal(fetchCalls, 2);
});

test("the total deadline aborts the HTTP body and destroys an active database client", async () => {
  let httpAborted = false;
  let rejectQuery: ((error: Error) => void) | undefined;
  const releases: Array<boolean | undefined> = [];
  const checker = createReadinessChecker({
    databaseUrl: "postgresql://readiness@127.0.0.1/classroom",
    expectedMigrationId: migrationId,
    deadlineMs: 30,
    fetchImplementation: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            httpAborted = true;
            reject(init.signal?.reason);
          },
          { once: true },
        );
      }),
    poolFactory: () => ({
      async connect() {
        return {
          query() {
            return new Promise<{ rows: [] }>((_resolve, reject) => {
              rejectQuery = reject;
            });
          },
          release(destroy?: boolean) {
            releases.push(destroy);
            rejectQuery?.(new Error("connection destroyed"));
          },
        };
      },
      async end() {},
    }),
  });

  const startedAt = performance.now();
  assert.equal(await checker.checkReadiness(), false);
  assert.ok(performance.now() - startedAt < 500);
  assert.equal(httpAborted, true);
  assert.deepEqual(releases, [true]);
});

test("draining overrides a cached success and closes the pool", async () => {
  const database = successfulPool();
  const checker = createReadinessChecker({
    databaseUrl: "postgresql://readiness@127.0.0.1/classroom",
    expectedMigrationId: migrationId,
    fetchImplementation: async () => healthyResponse(),
    poolFactory: () => database.pool,
  });

  assert.equal(await checker.checkReadiness(), true);
  checker.setDraining();
  assert.equal(await checker.checkReadiness(), false);
  await checker.close();
  assert.equal(database.ended, true);
});

test("entering drain aborts an active probe and destroys its database client", async () => {
  let rejectQuery: ((error: Error) => void) | undefined;
  const releases: Array<boolean | undefined> = [];
  const checker = createReadinessChecker({
    databaseUrl: "postgresql://readiness@127.0.0.1/classroom",
    expectedMigrationId: migrationId,
    deadlineMs: 200,
    fetchImplementation: async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason),
          {
            once: true,
          },
        );
      }),
    poolFactory: () => ({
      async connect() {
        return {
          query() {
            return new Promise<{ rows: [] }>((_resolve, reject) => {
              rejectQuery = reject;
            });
          },
          release(destroy?: boolean) {
            releases.push(destroy);
            rejectQuery?.(new Error("connection destroyed"));
          },
        };
      },
      async end() {},
    }),
  });

  const startedAt = performance.now();
  const probe = checker.checkReadiness();
  await new Promise((resolve) => setImmediate(resolve));
  checker.setDraining();

  assert.equal(await probe, false);
  assert.ok(performance.now() - startedAt < 100);
  assert.deepEqual(releases, [true]);
});

test("writes stable release metadata from the schema asset and supplied SHA", async (context) => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "mentor-release-"));
  context.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(rootDir, { recursive: true, force: true });
  });
  await mkdir(path.join(rootDir, "database/schema"), { recursive: true });
  await mkdir(path.join(rootDir, "artifacts/api-gateway/dist"), {
    recursive: true,
  });
  await writeFile(
    path.join(rootDir, "database/schema/version.json"),
    JSON.stringify({ currentMigrationId: migrationId }),
  );

  await writeReleaseMetadata({
    rootDir,
    releaseSha: "35faaac66ff2a6881026f6e2df6d73000131e92e",
  });

  assert.equal(
    await readFile(
      path.join(rootDir, "artifacts/api-gateway/dist/release.json"),
      "utf8",
    ),
    '{\n  "currentMigrationId": "0002_integrity_constraints_indexes",\n  "releaseSha": "35faaac66ff2a6881026f6e2df6d73000131e92e"\n}\n',
  );
});

test("keeps liveness independent and exposes only the readiness status contract", async (context) => {
  let ready = false;
  let readinessCalls = 0;
  const gateway = createGatewayServer({
    upstreamOrigin: "http://127.0.0.1:8181",
    publicOrigin,
    allowLoopbackPublicOrigin: true,
    checkReadiness: async () => {
      readinessCalls += 1;
      return ready;
    },
    logger: { info() {} },
  });
  const origin = await listen(gateway);
  context.after(() => close(gateway));

  const live = await fetch(origin + "/livez");
  assert.equal(live.status, 200);
  assert.deepEqual(await live.json(), { status: "ok" });
  assert.equal(readinessCalls, 0);

  const unavailable = await fetch(origin + "/readyz");
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), { status: "not_ready" });

  ready = true;
  const available = await fetch(origin + "/readyz");
  assert.equal(available.status, 200);
  assert.deepEqual(await available.json(), { status: "ready" });
  assert.equal(readinessCalls, 2);
});

test("maintenance stays live but is not ready to serve traffic", async (context) => {
  let readinessCalls = 0;
  const gateway = createGatewayServer({
    upstreamOrigin: "http://127.0.0.1:8181",
    publicOrigin,
    allowLoopbackPublicOrigin: true,
    maintenanceMode: true,
    checkReadiness: async () => {
      readinessCalls += 1;
      return true;
    },
    logger: { info() {} },
  });
  const origin = await listen(gateway);
  context.after(() => close(gateway));

  assert.equal((await fetch(origin + "/livez")).status, 200);
  const ready = await fetch(origin + "/readyz");
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), { status: "not_ready" });
  assert.equal(readinessCalls, 0);
});

test("HTTP logs contain only sanitized family, outcome, status, ids, and timings", async (context) => {
  const logEntries: Array<{
    event: string;
    fields: Record<string, boolean | number | string>;
  }> = [];
  const upstream = createServer((request, response) => {
    if (request.url?.startsWith("/api/districts")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end("[]");
      return;
    }
    response.writeHead(401, { "content-type": "application/json" });
    response.end('{"detail":"UPSTREAM_BODY_CANARY"}');
  });
  const upstreamOrigin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin,
    publicOrigin,
    allowLoopbackPublicOrigin: true,
    checkReadiness: async () => {
      throw new Error("SELECT SQL_LOG_CANARY FROM secret_table");
    },
    logger: {
      info(event, fields) {
        logEntries.push({ event, fields: { ...fields } });
      },
    },
  });
  const origin = await listen(gateway);
  context.after(async () => Promise.all([close(gateway), close(upstream)]));

  const untrustedRequestId = "UNTRUSTED_REQUEST_ID_CANARY";
  assert.equal(
    (
      await fetch(origin + "/readyz", {
        headers: { "x-request-id": untrustedRequestId },
      })
    ).status,
    503,
  );
  assert.equal(
    (
      await fetch(origin + "/api/auth/login", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "session=COOKIE_LOG_CANARY",
          origin: publicOrigin,
        },
        body: JSON.stringify({
          email: "email-log-canary@example.edu",
          password: "valid-password",
        }),
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(
        origin + "/api/districts?search=query-log-canary&type=unified",
      )
    ).status,
    200,
  );
  assert.equal(
    (await fetch(origin + "/unknown/raw-log-canary?secret=query-canary"))
      .status,
    404,
  );

  assert.equal(logEntries.length, 4);
  const allowedFields = new Set([
    "family",
    "outcome",
    "status",
    "requestId",
    "durationMs",
    "upstreamDurationMs",
  ]);
  for (const entry of logEntries) {
    assert.equal(entry.event, "gateway_http");
    assert.ok(Object.keys(entry.fields).every((key) => allowedFields.has(key)));
    assert.equal(typeof entry.fields.family, "string");
    assert.equal(typeof entry.fields.outcome, "string");
    assert.equal(typeof entry.fields.status, "number");
    assert.match(String(entry.fields.requestId), /^[0-9a-f-]{36}$/);
    assert.equal(typeof entry.fields.durationMs, "number");
  }
  assert.deepEqual(
    logEntries.map(({ fields }) => [
      fields.family,
      fields.outcome,
      fields.status,
    ]),
    [
      ["readiness", "not_ready", 503],
      ["auth", "proxied", 401],
      ["districts", "proxied", 200],
      ["unknown", "not_found", 404],
    ],
  );
  assert.equal(typeof logEntries[1]?.fields.upstreamDurationMs, "number");
  assert.equal(typeof logEntries[2]?.fields.upstreamDurationMs, "number");
  assert.doesNotMatch(
    JSON.stringify(logEntries),
    /SQL_LOG_CANARY|COOKIE_LOG_CANARY|email-log-canary|query-log-canary|raw-log-canary|query-canary|UPSTREAM_BODY_CANARY|UNTRUSTED_REQUEST_ID_CANARY|\/api\/|\/readyz|\/unknown/,
  );
});

import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import test from "node:test";

import { createGatewayServer } from "../src/gateway.js";
import {
  assertAllowedOrigin,
  assertValidPublicOrigin,
  createLimiter,
  validateAuthBody,
} from "../src/request-controls.js";
import { requestFixture, userFixture } from "./contract-fixtures.js";

const DEV_PUBLIC_ORIGIN = "http://127.0.0.1:14200";

interface UpstreamCall {
  readonly body: string;
  readonly cookie: string | undefined;
  readonly method: string;
  readonly path: string;
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return "http://127.0.0.1:" + String(address.port);
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
}

async function startControlFixture(now: () => number = Date.now): Promise<{
  readonly calls: UpstreamCall[];
  readonly gateway: Server;
  readonly gatewayOrigin: string;
  readonly upstream: Server;
}> {
  const calls: UpstreamCall[] = [];
  const upstream = createServer(async (request, response) => {
    const body = await readBody(request);
    calls.push({
      body,
      cookie: request.headers.cookie,
      method: request.method ?? "GET",
      path: request.url ?? "/",
    });

    if (request.url === "/api/auth/me") {
      const match = /session=user-(\d+)/.exec(request.headers.cookie ?? "");
      if (!match) {
        sendJson(response, 401, { detail: "not authenticated" });
        return;
      }
      const id = Number(match[1]);
      sendJson(response, 200, {
        ...userFixture,
        id,
        email: `student-${id}@example.edu`,
      });
      return;
    }

    if (
      request.url === "/api/auth/login" ||
      request.url === "/api/auth/register"
    ) {
      sendJson(response, request.url.endsWith("register") ? 201 : 200, {
        user: userFixture,
        message: "Authenticated",
      });
      return;
    }

    if (request.url === "/api/auth/logout") {
      sendJson(response, 200, { message: "Logged out" });
      return;
    }

    if (request.url === "/api/requests/1/match") {
      sendJson(response, 200, requestFixture);
      return;
    }

    if (request.url === "/api/chat/rooms") {
      sendJson(response, 200, []);
      return;
    }

    if (
      request.url?.startsWith("/api/matches") ||
      request.url?.startsWith("/api/practice/matching")
    ) {
      sendJson(response, 200, {
        success: true,
        status: "connected",
        question_id: 1,
        limit: 5,
        matches: [],
      });
      return;
    }

    if (request.url === "/api/practice/locations/test") {
      sendJson(response, 200, {
        success: true,
        status: "connected",
      });
      return;
    }

    if (
      request.url === "/api/practice/status" ||
      request.url === "/api/practice/raw/find_matches"
    ) {
      sendJson(response, 200, { success: true, status: "connected" });
      return;
    }

    if (request.url === "/api/districts") {
      sendJson(response, 200, []);
      return;
    }

    sendJson(response, 404, { detail: "not found" });
  });
  const upstreamOrigin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin,
    publicOrigin: DEV_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
    rateLimitNow: now,
    logger: { info() {} },
  });
  const gatewayOrigin = await listen(gateway);
  return { calls, gateway, gatewayOrigin, upstream };
}

test("accepts only the exact configured request origin", () => {
  assert.doesNotThrow(() =>
    assertAllowedOrigin(
      "https://classroom.example",
      "https://classroom.example",
    ),
  );

  for (const origin of [
    undefined,
    "null",
    "https://evil.invalid",
    "https://classroom.example.evil.invalid",
    "https://classroom.example/",
  ]) {
    assert.throws(
      () => assertAllowedOrigin(origin, "https://classroom.example"),
      /origin_not_allowed/,
    );
  }
});

test("requires a canonical HTTPS public origin by default", () => {
  assert.doesNotThrow(() =>
    assertValidPublicOrigin("https://classroom.example"),
  );
  assert.doesNotThrow(() =>
    assertValidPublicOrigin("https://classroom.example:8443"),
  );

  for (const origin of [
    "http://classroom.example",
    "https://classroom.example/",
    "https://CLASSROOM.example",
    "https://classroom.example:443",
    "https://user@classroom.example",
    "https://classroom.example/path",
    "https://classroom.example?query=1",
    "https://classroom.example#fragment",
    "not an origin",
  ]) {
    assert.throws(() => assertValidPublicOrigin(origin), /public origin/);
  }
});

test("allows HTTP only for explicit loopback development origins", () => {
  for (const origin of [
    "http://127.0.0.1:14200",
    "http://[::1]:14200",
    "http://localhost:14200",
  ]) {
    assert.throws(() => assertValidPublicOrigin(origin), /public origin/);
    assert.doesNotThrow(() => assertValidPublicOrigin(origin, true));
  }

  for (const origin of [
    "http://classroom.example:14200",
    "http://localhost.evil.invalid:14200",
    "http://127.0.0.2:14200",
  ]) {
    assert.throws(() => assertValidPublicOrigin(origin, true), /public origin/);
  }
});

test("limits each key for 60 seconds and returns an integer retry delay", () => {
  let now = 0;
  const limiter = createLimiter(() => now);

  for (let count = 0; count < 10; count += 1) {
    assert.deepEqual(limiter.take("login:fixture", 10), {
      allowed: true,
      retryAfter: 0,
    });
  }
  assert.deepEqual(limiter.take("login:fixture", 10), {
    allowed: false,
    retryAfter: 60,
  });

  now = 1_001;
  assert.deepEqual(limiter.take("login:fixture", 10), {
    allowed: false,
    retryAfter: 59,
  });

  now = 60_000;
  assert.deepEqual(limiter.take("login:fixture", 10), {
    allowed: true,
    retryAfter: 0,
  });
});

test("tracks keys independently", () => {
  const limiter = createLimiter(() => 0);

  assert.equal(limiter.take("login:one", 1).allowed, true);
  assert.equal(limiter.take("login:one", 1).allowed, false);
  assert.equal(limiter.take("login:two", 1).allowed, true);
});

test("rejects new keys at the storage cap and reclaims expired entries", () => {
  let now = 0;
  const limiter = createLimiter(() => now);

  for (let key = 0; key < 10_000; key += 1) {
    assert.equal(limiter.take("session:" + String(key), 1).allowed, true);
  }

  assert.deepEqual(limiter.take("session:overflow", 1), {
    allowed: false,
    retryAfter: 60,
  });

  now = 60_000;
  assert.deepEqual(limiter.take("session:overflow", 1), {
    allowed: true,
    retryAfter: 0,
  });
});

test("rejects invalid limits without retaining a key", () => {
  const limiter = createLimiter(() => 0);

  for (const limit of [0, -1, 1.5, Number.NaN]) {
    assert.throws(() => limiter.take("invalid", limit), /positive integer/);
  }
  assert.equal(limiter.take("valid", 1).allowed, true);
});

test("validates login JSON while preserving its original bytes", () => {
  const body = Buffer.from(
    '{"email":" Student@Example.EDU ","password":"secret"}',
  );

  const result = validateAuthBody("login", body);

  assert.equal(result.body, body);
  assert.equal(
    result.accountKey,
    "3ba43c4927c41495293b7c4a35e075548d8c1dfc9ee602905671418f7c55de60",
  );
});

test("accepts only the login model's required keys and string values", () => {
  const invalidBodies = [
    undefined,
    Buffer.alloc(0),
    Buffer.from("not json"),
    Buffer.from("null"),
    Buffer.from("[]"),
    Buffer.from('{"email":"student@example.edu"}'),
    Buffer.from(
      '{"email":"student@example.edu","password":"secret","role":"mentor"}',
    ),
    Buffer.from('{"email":7,"password":"secret"}'),
    Buffer.from('{"email":"student@example.edu","password":7}'),
  ];

  for (const body of invalidBodies) {
    assert.throws(() => validateAuthBody("login", body), /invalid_auth_body/);
  }
});

test("enforces the bcrypt 72-byte password boundary without truncation", () => {
  for (const password of ["a".repeat(72), "🔐".repeat(18)]) {
    const body = Buffer.from(
      JSON.stringify({ email: "student@example.edu", password }),
    );
    assert.equal(validateAuthBody("login", body).body, body);
  }

  for (const password of ["", "a".repeat(73), "🔐".repeat(19)]) {
    const body = Buffer.from(
      JSON.stringify({ email: "student@example.edu", password }),
    );
    assert.throws(() => validateAuthBody("login", body), /invalid_auth_body/);
  }
});

test("accepts only the existing registration model", () => {
  for (const role of ["mentor", "mentee", "both"]) {
    const valid = Buffer.from(
      JSON.stringify({
        email: "student@example.edu",
        name: "Student",
        password: "secret",
        role,
        districtId: 1,
      }),
    );
    assert.equal(validateAuthBody("register", valid).body, valid);
  }

  const invalidPayloads = [
    {},
    {
      email: "student@example.edu",
      name: "Student",
      password: "secret",
      role: "both",
    },
    {
      email: "student@example.edu",
      name: "Student",
      password: "secret",
      role: "both",
      districtId: 1,
      subjects: [],
    },
    {
      email: "student@example.com",
      name: "Student",
      password: "secret",
      role: "both",
      districtId: 1,
    },
    {
      email: "student@example.edu",
      name: 7,
      password: "secret",
      role: "both",
      districtId: 1,
    },
    {
      email: "student@example.edu",
      name: "Student",
      password: "secret",
      role: "admin",
      districtId: 1,
    },
    {
      email: "student@example.edu",
      name: "Student",
      password: "secret",
      role: "both",
      districtId: 1.5,
    },
  ];

  for (const payload of invalidPayloads) {
    assert.throws(
      () => validateAuthBody("register", Buffer.from(JSON.stringify(payload))),
      /invalid_auth_body/,
    );
  }
});

test("requires explicit public origin configuration and sets server bounds", () => {
  let unconfigured: Server | undefined;
  assert.throws(() => {
    unconfigured = createGatewayServer({
      upstreamOrigin: "http://127.0.0.1:8181",
    });
  }, /GATEWAY_PUBLIC_ORIGIN is required/);
  unconfigured?.close();

  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    assert.throws(
      () =>
        createGatewayServer({
          upstreamOrigin: "http://127.0.0.1:8181",
          publicOrigin: DEV_PUBLIC_ORIGIN,
          allowLoopbackPublicOrigin: true,
        }),
      /canonical HTTPS public origin/,
    );
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
  }

  const gateway = createGatewayServer({
    upstreamOrigin: "http://127.0.0.1:8181",
    publicOrigin: DEV_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
  });
  assert.equal(gateway.headersTimeout, 10_000);
  assert.equal(gateway.requestTimeout, 15_000);
  assert.equal(gateway.keepAliveTimeout, 5_000);
  assert.equal(gateway.maxHeadersCount, 64);
  gateway.close();
});

test("rejects missing, null, hostile, and forwarded-host mutation origins before upstream", async (context) => {
  const fixture = await startControlFixture();
  context.after(async () =>
    Promise.all([close(fixture.gateway), close(fixture.upstream)]),
  );
  const body = JSON.stringify({
    email: "student@example.edu",
    password: "secret",
  });

  for (const headers of [
    { "content-type": "application/json" },
    { "content-type": "application/json", origin: "null" },
    {
      "content-type": "application/json",
      origin: "https://evil.invalid",
      "x-forwarded-host": "127.0.0.1:14200",
    },
  ]) {
    const response = await fetch(fixture.gatewayOrigin + "/api/auth/login", {
      method: "POST",
      headers,
      body,
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: "forbidden" });
  }

  assert.equal(fixture.calls.length, 0);
});

test("allows no-origin GET polling and allowed-origin bodyless mutations", async (context) => {
  const fixture = await startControlFixture();
  context.after(async () =>
    Promise.all([close(fixture.gateway), close(fixture.upstream)]),
  );

  const districts = await fetch(fixture.gatewayOrigin + "/api/districts");
  assert.equal(districts.status, 200);

  for (const path of ["/api/auth/logout", "/api/requests/1/match"]) {
    const response = await fetch(fixture.gatewayOrigin + path, {
      method: "POST",
      headers: {
        cookie: "session=user-1",
        origin: DEV_PUBLIC_ORIGIN,
      },
    });
    assert.equal(response.status, 200, path);
  }

  assert.deepEqual(
    fixture.calls.map((call) => call.path),
    [
      "/api/districts",
      "/api/auth/me",
      "/api/auth/logout",
      "/api/auth/me",
      "/api/requests/1/match",
    ],
  );
});

test("rejects invalid auth bodies before upstream and forwards accepted bytes unchanged", async (context) => {
  const fixture = await startControlFixture();
  context.after(async () =>
    Promise.all([close(fixture.gateway), close(fixture.upstream)]),
  );

  const invalidBodies = [
    "not json",
    "null",
    JSON.stringify({ email: "student@example.edu", password: "" }),
    JSON.stringify({
      email: "student@example.edu",
      password: "🔐".repeat(19),
    }),
    JSON.stringify({
      email: "student@example.edu",
      password: "secret",
      extra: true,
    }),
  ];
  for (const body of invalidBodies) {
    const response = await fetch(fixture.gatewayOrigin + "/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: DEV_PUBLIC_ORIGIN,
      },
      body,
    });
    assert.equal(response.status, 400, body);
  }

  const noBody = await fetch(fixture.gatewayOrigin + "/api/auth/login", {
    method: "POST",
    headers: { origin: DEV_PUBLIC_ORIGIN },
  });
  assert.equal(noBody.status, 400);

  const missingContentType = await fetch(
    fixture.gatewayOrigin + "/api/auth/login",
    {
      method: "POST",
      headers: { origin: DEV_PUBLIC_ORIGIN },
      body: JSON.stringify({
        email: "student@example.edu",
        password: "secret",
      }),
    },
  );
  assert.equal(missingContentType.status, 415);
  assert.equal(fixture.calls.length, 0);

  const loginBody =
    '{"email":" Student@Example.EDU ","password":"' + "a".repeat(72) + '"}';
  const login = await fetch(fixture.gatewayOrigin + "/api/auth/login", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: DEV_PUBLIC_ORIGIN,
    },
    body: loginBody,
  });
  assert.equal(login.status, 200);
  assert.equal(fixture.calls.at(-1)?.body, loginBody);

  const registerBody =
    '{ "email": "student@example.edu", "name": "Student", "password": "secret", "role": "both", "districtId": 1 }';
  const register = await fetch(fixture.gatewayOrigin + "/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: DEV_PUBLIC_ORIGIN,
    },
    body: registerBody,
  });
  assert.equal(register.status, 201);
  assert.equal(fixture.calls.at(-1)?.body, registerBody);
});

test("applies account and global authentication plans with injected time", async (context) => {
  let now = 0;
  const fixture = await startControlFixture(() => now);
  context.after(async () =>
    Promise.all([close(fixture.gateway), close(fixture.upstream)]),
  );
  const login = (email: string) =>
    fetch(fixture.gatewayOrigin + "/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: DEV_PUBLIC_ORIGIN,
        "x-forwarded-for": `198.51.100.${fixture.calls.length % 250}`,
      },
      body: JSON.stringify({ email, password: "secret" }),
    });

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await login(
      attempt % 2 === 0 ? " Student@Example.EDU " : "student@example.edu",
    );
    assert.equal(response.status, 200);
  }
  const accountLimited = await login("student@example.edu");
  assert.equal(accountLimited.status, 429);
  assert.equal(accountLimited.headers.get("retry-after"), "60");
  assert.deepEqual(await accountLimited.json(), { error: "rate_limited" });

  now = 60_000;
  assert.equal((await login("student@example.edu")).status, 200);

  now = 120_000;
  for (let account = 0; account < 120; account += 1) {
    assert.equal((await login(`student-${account}@example.edu`)).status, 200);
  }
  const globalLimited = await login("student-overflow@example.edu");
  assert.equal(globalLimited.status, 429);
  assert.equal(globalLimited.headers.get("retry-after"), "60");
});

test("applies the 30-per-minute registration plan", async (context) => {
  const fixture = await startControlFixture(() => 0);
  context.after(async () =>
    Promise.all([close(fixture.gateway), close(fixture.upstream)]),
  );

  for (let account = 0; account < 30; account += 1) {
    const response = await fetch(fixture.gatewayOrigin + "/api/auth/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: DEV_PUBLIC_ORIGIN,
      },
      body: JSON.stringify({
        email: `student-${account}@example.edu`,
        name: "Student",
        password: "secret",
        role: "mentee",
        districtId: 1,
      }),
    });
    assert.equal(response.status, 201);
  }

  const limited = await fetch(fixture.gatewayOrigin + "/api/auth/register", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: DEV_PUBLIC_ORIGIN,
    },
    body: JSON.stringify({
      email: "student-overflow@example.edu",
      name: "Student",
      password: "secret",
      role: "mentee",
      districtId: 1,
    }),
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("applies the 60-per-minute session mutation plan to Connect", async (context) => {
  const fixture = await startControlFixture(() => 0);
  context.after(async () =>
    Promise.all([close(fixture.gateway), close(fixture.upstream)]),
  );
  const connect = () =>
    fetch(fixture.gatewayOrigin + "/api/requests/1/match", {
      method: "POST",
      headers: {
        cookie: "session=user-1",
        origin: DEV_PUBLIC_ORIGIN,
      },
    });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    assert.equal((await connect()).status, 200);
  }
  const limited = await connect();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(
    fixture.calls.filter((call) => call.path === "/api/requests/1/match")
      .length,
    60,
  );
});

test("shares the 12-per-minute expensive bucket across matching aliases and practice computation", async (context) => {
  const fixture = await startControlFixture(() => 0);
  context.after(async () =>
    Promise.all([close(fixture.gateway), close(fixture.upstream)]),
  );
  const calls = [
    ["GET", "/api/matches/1?limit=5", undefined],
    ["GET", "/api/practice/matching/1?limit=5", undefined],
    ["POST", "/api/matches", '{"questionId":1}'],
    ["POST", "/api/practice/locations/test", '{"input":"school"}'],
  ] as const;

  for (let round = 0; round < 3; round += 1) {
    for (const [method, path, body] of calls) {
      const response = await fetch(fixture.gatewayOrigin + path, {
        method,
        headers: {
          cookie: "session=user-1",
          ...(body === undefined
            ? {}
            : {
                "content-type": "application/json",
                origin: DEV_PUBLIC_ORIGIN,
              }),
        },
        body,
      });
      assert.equal(response.status, 200, method + " " + path);
    }
  }

  const limited = await fetch(fixture.gatewayOrigin + "/api/matches/1", {
    headers: { cookie: "session=user-1" },
  });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
});

test("allows classroom polling and informational practice GETs without mutation limiting", async (context) => {
  const fixture = await startControlFixture(() => 0);
  context.after(async () =>
    Promise.all([close(fixture.gateway), close(fixture.upstream)]),
  );

  for (let poll = 0; poll < 4; poll += 1) {
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        fetch(fixture.gatewayOrigin + "/api/chat/rooms", {
          headers: { cookie: `session=user-${index + 1}` },
        }),
      ),
    );
    assert.ok(responses.every((response) => response.status === 200));
  }

  assert.equal(
    fixture.calls.filter((call) => call.path === "/api/chat/rooms").length,
    80,
  );

  for (const path of [
    "/api/practice/status",
    "/api/practice/raw/find_matches",
  ]) {
    for (let request = 0; request < 13; request += 1) {
      const response = await fetch(fixture.gatewayOrigin + path, {
        headers: { cookie: "session=user-1" },
      });
      assert.equal(response.status, 200, path);
    }
  }
});

import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { connect } from "node:net";
import { test } from "node:test";
import {
  createGatewayServer,
  type GatewayLogger,
  type GatewayOptions,
} from "./gateway.js";

interface UpstreamCall {
  readonly body: string;
  readonly cookie: string | undefined;
  readonly method: string;
  readonly path: string;
}

const quietLogger: GatewayLogger = {
  info() {},
};
const TEST_PUBLIC_ORIGIN = "http://127.0.0.1:14200";

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return "http://127.0.0.1:" + address.port;
}

async function close(server: Server): Promise<void> {
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

const userFixture = {
  id: 7,
  email: "student@example.test",
  name: "Student",
  role: "mentee",
  districtId: 1,
  districtName: "School",
  bio: null,
  subjects: [],
  isVerified: true,
  createdAt: "2026-01-01T00:00:00",
};

function createFixtureUpstream(calls: UpstreamCall[]): Server {
  return createServer(async (request, response) => {
    const body = await readBody(request);
    calls.push({
      body,
      cookie: request.headers.cookie,
      method: request.method ?? "GET",
      path: request.url ?? "/",
    });

    if (request.url === "/api/healthz") {
      response.writeHead(200, {
        "content-type": "application/json",
        location: "http://127.0.0.1:8181/api/private",
        "x-upstream-marker": "health",
      });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (request.url === "/api/auth/login") {
      response.writeHead(201, {
        "content-type": "application/json",
        "set-cookie": [
          "peerbridge_session=valid; HttpOnly; Path=/",
          "csrf=issued; Path=/",
        ],
      });
      response.end(
        JSON.stringify({
          user: userFixture,
          message: "Logged in successfully",
        }),
      );
      return;
    }

    if (request.url === "/api/auth/register") {
      response.writeHead(201, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          user: userFixture,
          message: "Registered successfully",
        }),
      );
      return;
    }

    if (request.url === "/api/auth/me") {
      if (request.headers.cookie === "peerbridge_session=valid") {
        response.writeHead(200, {
          "cache-control": "public, max-age=3600",
          "content-type": "application/json",
          vary: "Accept-Encoding, accept-encoding",
        });
        response.end(JSON.stringify(userFixture));
        return;
      }

      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ detail: "not authenticated" }));
      return;
    }

    if (request.url === "/api/auth/logout") {
      response.writeHead(200, {
        "content-type": "application/json",
        "set-cookie": "peerbridge_session=; Max-Age=0; Path=/",
      });
      response.end(JSON.stringify({ message: "Logged out successfully" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ detail: "unexpected route" }));
  });
}

async function startFixture(
  gatewayOptions: Omit<GatewayOptions, "upstreamOrigin" | "logger"> = {},
  upstream: Server = createFixtureUpstream([]),
): Promise<{
  gateway: Server;
  gatewayOrigin: string;
  upstream: Server;
  upstreamOrigin: string;
}> {
  const upstreamOrigin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
    logger: quietLogger,
    ...gatewayOptions,
  });
  const gatewayOrigin = await listen(gateway);
  return { gateway, gatewayOrigin, upstream, upstreamOrigin };
}

async function stopFixture(fixture: {
  gateway: Server;
  upstream: Server;
}): Promise<void> {
  await close(fixture.gateway);
  await close(fixture.upstream);
}

async function rawRequest(origin: string, request: string): Promise<string> {
  const url = new URL(origin);

  return new Promise((resolve, reject) => {
    const socket = connect({ host: url.hostname, port: Number(url.port) });
    let output = "";

    socket.setEncoding("utf8");
    socket.once("connect", () => socket.end(request));
    socket.on("data", (chunk) => {
      output += chunk;
    });
    socket.once("end", () => resolve(output));
    socket.once("error", reject);
  });
}

function responseStatus(rawResponse: string): number {
  const match = /^HTTP\/1\.1 (\d{3})/m.exec(rawResponse);
  assert.ok(match);
  return Number(match[1]);
}

function getSetCookies(response: Response): readonly string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  return typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : [headers.get("set-cookie")].filter(
        (value): value is string => value !== null,
      );
}

test("accepts only a literal loopback private upstream", () => {
  assert.throws(
    () => createGatewayServer({ upstreamOrigin: "https://api.example.test" }),
    /loopback origin/,
  );
  assert.throws(
    () => createGatewayServer({ upstreamOrigin: "http://localhost:8181" }),
    /loopback origin/,
  );

  const gateway = createGatewayServer({
    upstreamOrigin: "http://127.0.0.1:8181",
    publicOrigin: TEST_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
  });
  gateway.close();
});

test("proxies registered public routes and deliberately forwards response data", async () => {
  const calls: UpstreamCall[] = [];
  const fixture = await startFixture({}, createFixtureUpstream(calls));

  try {
    const livez = await fetch(fixture.gatewayOrigin + "/livez");
    assert.equal(livez.status, 200);
    assert.deepEqual(await livez.json(), { status: "ok" });
    assert.equal(calls.length, 0);

    const health = await fetch(fixture.gatewayOrigin + "/api/healthz");
    assert.equal(health.status, 200);
    assert.equal(health.headers.get("x-upstream-marker"), null);
    assert.equal(health.headers.get("location"), null);
    assert.deepEqual(await health.json(), { status: "ok" });

    const loginPayload = JSON.stringify({
      email: "student@example.test",
      password: "safe-test-password",
    });
    const login = await fetch(fixture.gatewayOrigin + "/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_PUBLIC_ORIGIN,
      },
      body: loginPayload,
    });
    assert.equal(login.status, 201);
    assert.deepEqual(await login.json(), {
      user: userFixture,
      message: "Logged in successfully",
    });
    assert.deepEqual(getSetCookies(login), [
      "peerbridge_session=valid; HttpOnly; Path=/",
      "csrf=issued; Path=/",
    ]);
    assert.equal(calls[1]?.body, loginPayload);
  } finally {
    await stopFixture(fixture);
  }
});

test("denies unregistered methods, invalid queries, and path-normalization bypasses without upstream calls", async () => {
  const calls: UpstreamCall[] = [];
  const fixture = await startFixture({}, createFixtureUpstream(calls));

  try {
    for (const path of ["/api/not-a-route", "/api/districts/0"]) {
      const response = await fetch(fixture.gatewayOrigin + path);
      assert.equal(response.status, 404, path);
    }

    for (const path of [
      "/api/healthz?debug=true",
      "/api/requests?status=open&status=closed",
    ]) {
      const response = await fetch(fixture.gatewayOrigin + path, {
        headers: { cookie: "peerbridge_session=valid" },
      });
      assert.equal(response.status, 400, path);
    }

    const uppercase = await fetch(fixture.gatewayOrigin + "/API/healthz");
    assert.equal(uppercase.status, 400);

    const wrongMethod = await fetch(fixture.gatewayOrigin + "/api/healthz", {
      method: "POST",
    });
    assert.equal(wrongMethod.status, 404);

    for (const target of [
      "/api//admin/flagged-users",
      "/api/../admin/flagged-users",
      "/api/%2fadmin/flagged-users",
    ]) {
      const raw = await rawRequest(
        fixture.gatewayOrigin,
        "GET " +
          target +
          " HTTP/1.1\r\nHost: gateway.test\r\nConnection: close\r\n\r\n",
      );
      assert.ok([400, 404].includes(responseStatus(raw)), target);
    }

    const malformed = await rawRequest(
      fixture.gatewayOrigin,
      "GET /api/%ZZ HTTP/1.1\r\nHost: gateway.test\r\nConnection: close\r\n\r\n",
    );
    assert.equal(responseStatus(malformed), 400);

    assert.equal(calls.length, 0);
  } finally {
    await stopFixture(fixture);
  }
});

test("rejects duplicate request headers, unknown WebSocket paths and hostile origins before the upstream", async () => {
  const calls: UpstreamCall[] = [];
  const fixture = await startFixture({}, createFixtureUpstream(calls));

  try {
    const duplicateHeaders = await rawRequest(
      fixture.gatewayOrigin,
      "GET /api/healthz HTTP/1.1\r\n" +
        "Host: gateway.test\r\n" +
        "Accept: application/json\r\n" +
        "Accept: text/plain\r\n" +
        "Connection: close\r\n\r\n",
    );
    assert.equal(responseStatus(duplicateHeaders), 400);

    const upgrade = await rawRequest(
      fixture.gatewayOrigin,
      "GET /ws/chat/1 HTTP/1.1\r\n" +
        "Host: gateway.test\r\n" +
        "Origin: " +
        TEST_PUBLIC_ORIGIN +
        "\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    assert.equal(responseStatus(upgrade), 403);
    assert.match(upgrade, /websocket_unavailable/);

    const missingOriginUpgrade = await rawRequest(
      fixture.gatewayOrigin,
      "GET /ws/chat/rooms/1 HTTP/1.1\r\n" +
        "Host: gateway.test\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    assert.equal(responseStatus(missingOriginUpgrade), 403);
    assert.match(missingOriginUpgrade, /forbidden/);

    const unknownAuthenticatedUpgrade = await rawRequest(
      fixture.gatewayOrigin,
      "GET /ws/dms/0 HTTP/1.1\r\n" +
        "Host: gateway.test\r\n" +
        "Origin: " +
        TEST_PUBLIC_ORIGIN +
        "\r\n" +
        "Cookie: peerbridge_session=valid\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    assert.equal(responseStatus(unknownAuthenticatedUpgrade), 403);
    assert.match(unknownAuthenticatedUpgrade, /websocket_unavailable/);

    const hostileUpgrade = await rawRequest(
      fixture.gatewayOrigin,
      "GET /ws/chat/rooms/1 HTTP/1.1\r\n" +
        "Host: gateway.test\r\n" +
        "Origin: https://evil.invalid\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n",
    );
    assert.equal(responseStatus(hostileUpgrade), 403);
    assert.match(hostileUpgrade, /forbidden/);
    assert.equal(calls.length, 0);
  } finally {
    await stopFixture(fixture);
  }
});

test("requires the same cookie for protected paths and verifies a session before logout", async () => {
  const calls: UpstreamCall[] = [];
  const fixture = await startFixture({}, createFixtureUpstream(calls));

  try {
    const noCookie = await fetch(fixture.gatewayOrigin + "/api/auth/me");
    assert.equal(noCookie.status, 401);
    assert.equal(noCookie.headers.get("cache-control"), "no-store");
    assert.equal(noCookie.headers.get("vary"), "Cookie");
    assert.equal(calls.length, 0);

    const me = await fetch(fixture.gatewayOrigin + "/api/auth/me", {
      headers: { cookie: "peerbridge_session=valid" },
    });
    assert.equal(me.status, 200);
    assert.equal(me.headers.get("cache-control"), "no-store");
    assert.equal(me.headers.get("vary"), "Accept-Encoding, Cookie");
    assert.deepEqual(await me.json(), userFixture);
    assert.equal(calls[0]?.cookie, "peerbridge_session=valid");

    const invalidLogout = await fetch(
      fixture.gatewayOrigin + "/api/auth/logout",
      {
        method: "POST",
        headers: {
          cookie: "peerbridge_session=invalid",
          origin: TEST_PUBLIC_ORIGIN,
        },
      },
    );
    assert.equal(invalidLogout.status, 401);
    assert.equal(calls.at(-1)?.path, "/api/auth/me");

    const validLogout = await fetch(
      fixture.gatewayOrigin + "/api/auth/logout",
      {
        method: "POST",
        headers: {
          cookie: "peerbridge_session=valid",
          origin: TEST_PUBLIC_ORIGIN,
        },
      },
    );
    assert.equal(validLogout.status, 200);
    assert.deepEqual(await validLogout.json(), {
      message: "Logged out successfully",
    });
    assert.deepEqual(
      calls.slice(-2).map((call) => call.path),
      ["/api/auth/me", "/api/auth/logout"],
    );
    assert.ok(
      getSetCookies(validLogout).includes(
        "peerbridge_session=; Max-Age=0; Path=/",
      ),
    );
  } finally {
    await stopFixture(fixture);
  }
});

test("enforces request body limits and redacts credentials and payloads from gateway logs", async () => {
  const calls: UpstreamCall[] = [];
  const logEntries: Array<Record<string, unknown>> = [];
  const upstream = createFixtureUpstream(calls);
  const upstreamOrigin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
    requestBodyLimitBytes: 8,
    logger: {
      info(event, fields) {
        logEntries.push({ event, ...fields });
      },
    },
  });
  const gatewayOrigin = await listen(gateway);

  try {
    const tooLarge = await fetch(gatewayOrigin + "/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: TEST_PUBLIC_ORIGIN,
      },
      body: '"123456789"',
    });
    assert.equal(tooLarge.status, 413);
    assert.equal(calls.length, 0);

    const privatePayload = JSON.stringify({
      email: "private.student@example.test",
      password: "dont-log-this-password",
    });
    const login = await fetch(gatewayOrigin + "/api/auth/login", {
      method: "POST",
      headers: {
        authorization: "Bearer dont-log-this-token",
        "content-type": "application/json",
        cookie: "peerbridge_session=dont-log-this-cookie",
        origin: TEST_PUBLIC_ORIGIN,
      },
      body: privatePayload,
    });
    assert.equal(login.status, 413);

    const serializedLogs = JSON.stringify(logEntries);
    assert.doesNotMatch(serializedLogs, /private\.student@example\.test/);
    assert.doesNotMatch(serializedLogs, /dont-log-this-password/);
    assert.doesNotMatch(serializedLogs, /dont-log-this-token/);
    assert.doesNotMatch(serializedLogs, /dont-log-this-cookie/);
  } finally {
    await close(gateway);
    await close(upstream);
  }
});

test("returns a bounded timeout response when the private upstream does not answer", async () => {
  const upstream = createServer(
    (_request: IncomingMessage, _response: ServerResponse) => {
      // Keep the request open until the gateway's abort signal closes the socket.
    },
  );
  const fixture = await startFixture({ upstreamTimeoutMs: 25 }, upstream);

  try {
    const response = await fetch(fixture.gatewayOrigin + "/api/healthz");
    assert.equal(response.status, 504);
    assert.deepEqual(await response.json(), { error: "upstream_timeout" });
    assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  } finally {
    await stopFixture(fixture);
  }
});

test("maintenance mode preserves liveness but fail-closes API forwarding", async () => {
  const calls: UpstreamCall[] = [];
  const fixture = await startFixture(
    { maintenanceMode: true },
    createFixtureUpstream(calls),
  );

  try {
    const livez = await fetch(fixture.gatewayOrigin + "/livez");
    assert.equal(livez.status, 200);

    const health = await fetch(fixture.gatewayOrigin + "/api/healthz");
    assert.equal(health.status, 503);
    assert.deepEqual(await health.json(), { error: "maintenance" });
    assert.equal(calls.length, 0);
  } finally {
    await stopFixture(fixture);
  }
});

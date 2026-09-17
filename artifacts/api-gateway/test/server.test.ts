import assert from "node:assert/strict";
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
} from "node:http";
import test from "node:test";

import { createGatewayServer } from "../src/gateway.ts";
import {
  userFixture,
  requestFixture,
  overviewFixture,
} from "./contract-fixtures.ts";

interface UpstreamCall {
  body: string;
  cookie: string | undefined;
  method: string;
  path: string;
}

const TEST_PUBLIC_ORIGIN = "http://127.0.0.1:14200";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Server did not bind a TCP port");
  return address.port;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function rawRequest(
  port: number,
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
  body?: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      { hostname: "127.0.0.1", port, path, method, headers },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    request.once("error", reject);
    request.end(body);
  });
}

test("forwards one valid request from every REST family with exact method, target, body, and cookie", async (context) => {
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
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(userFixture));
      return;
    }
    if (request.url === "/api/users/2") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          id: 2,
          email: "private@example.edu",
          name: "Student Two",
          bio: "private",
          subjects: ["Science"],
          createdAt: "2026-08-27T00:00:00+00:00",
        }),
      );
      return;
    }
    if (request.method === "DELETE") {
      response.writeHead(204);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    const path = new URL(request.url ?? "/", "http://test").pathname;
    const payload =
      path === "/api/auth/logout" || path === "/api/reports"
        ? { message: "Completed" }
        : path === "/api/requests/2/match"
          ? requestFixture
          : path === "/api/stats/overview"
            ? overviewFixture
            : path === "/api/districts" || path === "/api/tags"
              ? []
              : path === "/api/chat/rooms/1/messages"
                ? {
                    id: 1,
                    roomId: 1,
                    senderId: 1,
                    senderName: "Student",
                    body: "hello",
                    createdAt: "2026-01-01",
                  }
                : path === "/api/dms/start"
                  ? {
                      id: 1,
                      otherUserId: 2,
                      otherUserName: "Other",
                      createdAt: "2026-01-01",
                    }
                  : path === "/api/healthz"
                    ? { status: "ok" }
                    : path.startsWith("/api/matches") ||
                        path.startsWith("/api/practice/matching")
                      ? {
                          success: true,
                          status: "connected",
                          question_id: 1,
                          limit: 5,
                          matches: [],
                        }
                      : {
                          ok: true,
                          source: "adapter-fallback",
                          student_module: null,
                          data: [],
                        };
    response.end(JSON.stringify(payload));
  });
  const upstreamPort = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
    logger: { info() {} },
  });
  const gatewayPort = await listen(gateway);
  context.after(async () => Promise.all([close(gateway), close(upstream)]));

  const cases = [
    { family: "auth", method: "GET", path: "/api/auth/me", session: false },
    {
      family: "auth-logout",
      method: "POST",
      path: "/api/auth/logout",
      session: true,
    },
    { family: "users", method: "GET", path: "/api/users/2", session: true },
    {
      family: "districts",
      method: "GET",
      path: "/api/districts?search=San%20Jose&type=unified",
      upstreamPath: "/api/districts?search=San+Jose&type=unified",
      session: false,
    },
    { family: "tags", method: "GET", path: "/api/tags", session: true },
    {
      family: "requests",
      method: "POST",
      path: "/api/requests/2/match",
      session: true,
    },
    {
      family: "requests-delete",
      method: "DELETE",
      path: "/api/requests/2",
      session: true,
      status: 204,
    },
    {
      family: "reports",
      method: "POST",
      path: "/api/reports",
      body: '{"reportedUserId":2,"reason":"spam"}',
      session: true,
    },
    {
      family: "blocks",
      method: "DELETE",
      path: "/api/blocks/2",
      session: true,
      status: 204,
    },
    {
      family: "stats",
      method: "GET",
      path: "/api/stats/overview",
      session: false,
    },
    {
      family: "matches",
      method: "GET",
      path: "/api/matches/1?limit=5",
      session: true,
    },
    {
      family: "chat",
      method: "POST",
      path: "/api/chat/rooms/1/messages",
      body: '{"body":"hello"}',
      session: true,
    },
    {
      family: "dms",
      method: "POST",
      path: "/api/dms/start",
      body: '{"toUserId":2}',
      session: true,
    },
    {
      family: "practice",
      method: "GET",
      path: "/api/practice/matching/1?limit=5",
      session: true,
    },
    {
      family: "analysis",
      method: "GET",
      path: "/api/analysis/status",
      session: true,
    },
    {
      family: "analytics",
      method: "GET",
      path: "/api/analytics/weekly-matches",
      session: true,
    },
    {
      family: "python-reports",
      method: "GET",
      path: "/api/python-reports/summary",
      session: true,
    },
    {
      family: "scheduling",
      method: "GET",
      path: "/api/scheduling/suggest?user_a=1&user_b=2",
      session: true,
    },
    {
      family: "admin",
      method: "GET",
      path: "/api/admin/flagged-users",
      session: true,
    },
    { family: "health", method: "GET", path: "/api/healthz", session: false },
  ] as const;

  for (const example of cases) {
    calls.length = 0;
    const headers: Record<string, string> = { cookie: "session=user-a" };
    if (example.method !== "GET") {
      headers.origin = TEST_PUBLIC_ORIGIN;
    }
    if (example.body !== undefined) {
      headers["content-type"] = "application/json";
      headers["content-length"] = String(Buffer.byteLength(example.body));
    }
    const result = await rawRequest(
      gatewayPort,
      example.path,
      example.method,
      headers,
      example.body,
    );
    assert.equal(result.status, example.status ?? 200, example.family);
    if ((example.status ?? 200) === 204)
      assert.equal(result.body, "", example.family);

    const forwarded = calls.at(-1);
    assert.ok(forwarded, example.family);
    assert.equal(forwarded.method, example.method, example.family);
    assert.equal(
      forwarded.path,
      example.upstreamPath ?? example.path,
      example.family,
    );
    assert.equal(forwarded.body, example.body ?? "", example.family);
    assert.equal(forwarded.cookie, "session=user-a", example.family);
    assert.equal(calls.length, example.session ? 2 : 1, example.family);
    if (example.session)
      assert.equal(calls[0]?.path, "/api/auth/me", example.family);
  }
});

test("forwards every allowed raw practice module once after session validation", async (context) => {
  const calls: UpstreamCall[] = [];
  const upstream = createServer(async (request, response) => {
    calls.push({
      body: await readBody(request),
      cookie: request.headers.cookie,
      method: request.method ?? "GET",
      path: request.url ?? "/",
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      request.url === "/api/auth/me"
        ? JSON.stringify(userFixture)
        : '{"success":true,"status":"connected"}',
    );
  });
  const upstreamPort = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
    logger: { info() {} },
  });
  const gatewayPort = await listen(gateway);
  context.after(async () => Promise.all([close(gateway), close(upstream)]));

  for (const moduleName of ["find_matches", "locations", "get_blocks"]) {
    calls.length = 0;
    const path = `/api/practice/raw/${moduleName}`;
    const result = await rawRequest(gatewayPort, path, "GET", {
      cookie: "session=user-a",
    });

    assert.equal(result.status, 200, moduleName);
    assert.deepEqual(
      calls.map((call) => call.path),
      ["/api/auth/me", path],
      moduleName,
    );
    assert.equal(calls[1]?.method, "GET", moduleName);
    assert.equal(calls[1]?.cookie, "session=user-a", moduleName);
  }
});

test("limits the practice location test body to 16 KiB before its upstream route", async (context) => {
  const calls: string[] = [];
  const upstream = createServer(async (request, response) => {
    await readBody(request);
    calls.push(request.url ?? "/");
    if (request.url === "/api/auth/me") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(userFixture));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  const upstreamPort = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
    logger: { info() {} },
  });
  const gatewayPort = await listen(gateway);
  context.after(async () => Promise.all([close(gateway), close(upstream)]));

  const body = JSON.stringify({ input: "x".repeat(16 * 1024) });
  const result = await rawRequest(
    gatewayPort,
    "/api/practice/locations/test",
    "POST",
    {
      cookie: "session=user-a",
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(body)),
      origin: TEST_PUBLIC_ORIGIN,
    },
    body,
  );

  assert.equal(result.status, 413);
  assert.deepEqual(calls, []);
});

test("rejects invalid paths, methods, and queries before any upstream request", async (context) => {
  const calls: string[] = [];
  const upstream = createServer((request, response) => {
    calls.push(request.url ?? "/");
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"id":1}');
  });
  const upstreamPort = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
    publicOrigin: TEST_PUBLIC_ORIGIN,
    allowLoopbackPublicOrigin: true,
    logger: { info() {} },
  });
  const gatewayPort = await listen(gateway);
  context.after(async () => Promise.all([close(gateway), close(upstream)]));

  const invalid = [
    ["GET", "/api/admin%2Fflagged-users"],
    ["GET", "/api/practice/matching/1?limit=1000&mentor_id=blocked"],
    ["GET", "/api/requests?status=open&status=closed"],
    ["POST", "/api/requests/1/match/extra"],
    ["GET", "/api/chat%2Frooms"],
    ["GET", "/api/dms//1/messages"],
    ["GET", "/api/not-a-route"],
    ["GET", "/api/practice/raw/not_a_module"],
    ["POST", "/api/healthz"],
    ["GET", "/ws/chat/1"],
  ] as const;

  for (const [method, path] of invalid) {
    const result = await rawRequest(gatewayPort, path, method, {
      cookie: "session=user-a",
    });
    assert.ok(result.status === 400 || result.status === 404, path);
  }
  assert.equal(calls.length, 0);
});

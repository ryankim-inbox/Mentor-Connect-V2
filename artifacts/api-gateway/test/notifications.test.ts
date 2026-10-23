import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createGatewayServer } from "../src/gateway.ts";
import { projectPublicPayload } from "../src/public-contract.ts";
import { requiredAuthority, resolvePublicRoute } from "../src/route-policy.ts";
import { userFixture } from "./contract-fixtures.ts";
import { validateSensitiveBody } from "../src/request-controls.ts";

const origin = "https://test.invalid";
const item = {
  id: 1,
  kind: "request_match",
  requestId: 2,
  message: "A matching request",
  createdAt: "2026-10-17T12:00:00+00:00",
  read: false,
};
const fixture = {
  unreadCount: 75,
  items: [
    item,
    {
      ...item,
      id: 2,
      kind: "request_match_summary",
      requestId: null,
      read: true,
    },
  ],
};
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
const invalid = [
  { ...fixture, unreadCount: -1 },
  { ...fixture, unreadCount: 0.5 },
  { ...fixture, items: Array.from({ length: 51 }, () => item) },
  ...[
    { id: 0 },
    { id: Number.MAX_SAFE_INTEGER + 1 },
    { kind: "admin" },
    { requestId: -1 },
    { createdAt: "today" },
    { createdAt: "2026-10-17T12:00:00" },
    { message: "" },
    { message: "😀".repeat(1001) },
    { read: "false" },
  ].map((patch) => ({ unreadCount: 1, items: [{ ...item, ...patch }] })),
];

test("notification response contract projects only public fields and bounds every item", async () => {
  assert.deepEqual(
    projectPublicPayload(
      {
        ...fixture,
        token: "private",
        items: fixture.items.map((row) => ({
          ...row,
          userId: 99,
          email: "private",
        })),
      },
      "/api/notifications",
      "GET",
    ),
    fixture,
  );
  const generated = await import("../../../lib/api-zod/src/generated/api.ts");
  assert.ok(generated.ListNotificationsResponse.safeParse(fixture).success);
  assert.ok(
    generated.MarkNotificationsReadResponse.safeParse(undefined).success,
  );
  assert.equal(
    generated.MarkNotificationsReadResponse.safeParse({}).success,
    false,
  );
  const unicode = {
    unreadCount: 1,
    items: [{ ...item, message: "😀".repeat(1000) }],
  };
  assert.ok(generated.ListNotificationsResponse.safeParse(unicode).success);
  assert.deepEqual(
    projectPublicPayload(unicode, "/api/notifications", "GET"),
    unicode,
  );
  for (const value of invalid) {
    assert.throws(() =>
      projectPublicPayload(value, "/api/notifications", "GET"),
    );
    assert.equal(
      generated.ListNotificationsResponse.safeParse(value).success,
      false,
      JSON.stringify(value).slice(0, 120),
    );
  }
});

test("notification routes allow only the optional observed IDs and no caller-selected identity", () => {
  for (const [method, path] of [
    ["GET", "/api/notifications"],
    ["POST", "/api/notifications/read"],
  ]) {
    const route = resolvePublicRoute(method, path)!;
    assert.equal(requiredAuthority(route), "student");
    assert.equal(route.allowsBody, method === "POST");
    assert.equal(route.requiresJson, method === "POST");
    assert.deepEqual(route.queryKeys, []);
    assert.throws(
      () => resolvePublicRoute(method, path + "?userId=2"),
      /invalid_query/,
    );
  }
  assert.equal(resolvePublicRoute("POST", "/api/notifications"), undefined);
  assert.equal(resolvePublicRoute("GET", "/api/notifications/read"), undefined);
});

test("notification observed ID body is optional but strictly validated when supplied", () => {
  for (const body of [
    undefined,
    Buffer.alloc(0),
    Buffer.from('{"ids":[1]}'),
    Buffer.from('{"ids":[9007199254740991]}'),
    Buffer.from(
      JSON.stringify({
        ids: Array.from({ length: 50 }, (_, index) => index + 1),
      }),
    ),
  ]) {
    assert.equal(
      validateSensitiveBody("/api/notifications/read", "POST", body),
      body,
    );
  }
  for (const payload of [
    {},
    null,
    [],
    { ids: [] },
    { ids: [1, 1] },
    { ids: [0] },
    { ids: [-1] },
    { ids: [1.5] },
    { ids: ["1"] },
    { ids: [true] },
    { ids: [Number.MAX_SAFE_INTEGER + 1] },
    { ids: [1], userId: 2 },
    { ids: null },
    { ids: 1 },
    { ids: Array.from({ length: 51 }, (_, index) => index + 1) },
    { throughId: 1 },
    { ids: [1], throughId: 1 },
  ]) {
    assert.throws(() =>
      validateSensitiveBody(
        "/api/notifications/read",
        "POST",
        Buffer.from(JSON.stringify(payload)),
      ),
    );
  }
});

test("gateway validates both notification operations, errors and fresh member authority", async (t) => {
  let identity: Record<string, unknown> = {
    ...userFixture,
    isVerified: false,
    hasMemberAccess: true,
  };
  let payload: unknown = fixture;
  let notificationStatus = 200;
  let readStatus = 204;
  const calls: string[] = [];
  const readBodies: string[] = [];
  const upstream = createServer(async (req, res) => {
    calls.push(req.method + " " + req.url);
    if (req.url === "/api/notifications/read") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      readBodies.push(Buffer.concat(chunks).toString());
    }
    const status =
      req.url === "/api/auth/me"
        ? 200
        : req.url === "/api/notifications/read"
          ? readStatus
          : notificationStatus;
    res.writeHead(status, {
      "content-type": "application/json",
      "x-private": "private",
    });
    res.end(
      status === 204
        ? undefined
        : JSON.stringify(req.url === "/api/auth/me" ? identity : payload),
    );
  });
  const gateway = createGatewayServer({
    upstreamOrigin: await listen(upstream),
    publicOrigin: origin,
    logger: { info() {} },
  });
  const base = await listen(gateway);
  t.after(async () => {
    for (const server of [gateway, upstream]) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  const call = (method: string, path: string, body?: string) =>
    fetch(base + path, {
      method,
      headers: {
        cookie: "session=synthetic",
        origin,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body,
    });
  const good = await call("GET", "/api/notifications");
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json(), fixture);
  assert.equal(good.headers.get("cache-control"), "no-store");
  assert.match(good.headers.get("vary") ?? "", /Cookie/);
  assert.ok(good.headers.get("x-request-id"));
  assert.equal(good.headers.get("x-private"), null);
  const read = await call("POST", "/api/notifications/read");
  assert.equal(read.status, 204);
  assert.equal(await read.text(), "");
  assert.ok(read.headers.get("x-request-id"));
  assert.equal(
    (await call("POST", "/api/notifications/read", '{"ids":[2]}')).status,
    204,
  );
  assert.deepEqual(readBodies, ["", '{"ids":[2]}']);
  for (const value of invalid) {
    payload = value;
    const response = await call("GET", "/api/notifications");
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: "backend_error" });
  }
  payload = fixture;
  for (const status of [201, 204]) {
    notificationStatus = status;
    assert.equal((await call("GET", "/api/notifications")).status, 502);
  }
  notificationStatus = 200;
  readStatus = 200;
  assert.equal((await call("POST", "/api/notifications/read")).status, 502);
  readStatus = 204;
  for (const flag of [false, "true", null]) {
    identity = { ...userFixture, isVerified: false, hasMemberAccess: flag };
    const before = calls.filter((entry) =>
      entry.includes("/api/notifications"),
    ).length;
    for (const [method, path] of [
      ["GET", "/api/notifications"],
      ["POST", "/api/notifications/read"],
    ])
      assert.equal((await call(method, path)).status, 403);
    assert.equal(
      calls.filter((entry) => entry.includes("/api/notifications")).length,
      before,
    );
  }
  identity = { ...userFixture };
  const before = calls.filter((entry) =>
    entry.includes("/api/notifications"),
  ).length;
  assert.equal(
    (
      await call(
        "POST",
        "/api/notifications/read",
        JSON.stringify({ userId: 2 }),
      )
    ).status,
    422,
  );
  assert.equal(
    calls.filter((entry) => entry.includes("/api/notifications")).length,
    before,
  );
  assert.equal((await fetch(base + "/api/notifications")).status, 401);
  assert.equal(
    (
      await fetch(base + "/api/notifications/read", {
        method: "POST",
        headers: { origin },
      })
    ).status,
    401,
  );
});

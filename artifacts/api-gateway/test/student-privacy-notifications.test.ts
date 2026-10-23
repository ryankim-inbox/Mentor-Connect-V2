import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createGatewayServer } from "../src/gateway.ts";
import {
  validateAuthBody,
  validateSensitiveBody,
} from "../src/request-controls.ts";
import { projectPublicPayload } from "../src/public-contract.ts";
import { requiredAuthority, resolvePublicRoute } from "../src/route-policy.ts";
import { requestFixture, userFixture } from "./contract-fixtures.ts";

const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const signup = {
  email: "student@example.edu",
  name: "Student",
  role: "mentee",
  districtId: 1,
  password: "LongPassword!",
  gender: "female",
  dateOfBirth: "2008-02-29",
};

test("registration requires exact demographic fields and a real nonfuture UTC date", () => {
  for (const gender of ["female", "male"]) {
    for (const dateOfBirth of [
      "0001-01-01",
      "2000-02-29",
      new Date().toISOString().slice(0, 10),
    ]) {
      const payload = { ...signup, gender, dateOfBirth };
      assert.deepEqual(
        JSON.parse(
          validateAuthBody("register", encode(payload)).body.toString(),
        ),
        payload,
      );
    }
  }
  for (const extra of [
    { gender: undefined },
    { dateOfBirth: undefined },
    { gender: null },
    { gender: "both" },
    { gender: "Female" },
    { gender: 1 },
    { dateOfBirth: "0000-01-01" },
    { dateOfBirth: "2001-02-29" },
    { dateOfBirth: "2000-04-31" },
    { dateOfBirth: "2000-13-01" },
    { dateOfBirth: "2000-00-01" },
    { dateOfBirth: "2000-01-00" },
    { dateOfBirth: "9999-01-01" },
    { dateOfBirth: "2000-1-01" },
    { dateOfBirth: "2000-01-01T00:00:00Z" },
    { dateOfBirth: 20000101 },
    { dateOfBirth: null },
    { isAdmin: true },
  ])
    assert.throws(
      () => validateAuthBody("register", encode({ ...signup, ...extra })),
      /invalid_auth_body/,
    );
});

test("registration password counts code points and retains the bcrypt byte boundary", () => {
  for (const password of [
    "A!" + "x".repeat(10),
    "A!" + "😀".repeat(10),
    "A!" + "x".repeat(70),
    "A!" + "😀".repeat(17) + "xx",
  ]) {
    assert.doesNotThrow(() =>
      validateAuthBody("register", encode({ ...signup, password })),
    );
  }
  for (const password of [
    "A!" + "x".repeat(9),
    "A!" + "😀".repeat(9),
    "a!" + "x".repeat(10),
    "A " + "x".repeat(10),
    "Ä!" + "x".repeat(10),
    "A！" + "x".repeat(10),
    "A!" + "x".repeat(71),
    "A!" + "😀".repeat(18),
    "A!" + "x".repeat(10) + "\ud800",
    "A!" + "x".repeat(10) + "\udfff",
  ])
    assert.throws(
      () => validateAuthBody("register", encode({ ...signup, password })),
      /invalid_auth_body/,
    );
  for (const password of ["secret", "😀", "a".repeat(72)]) {
    const body = encode({ email: signup.email, password });
    assert.equal(validateAuthBody("login", body).body, body);
  }
});

test("request titles preserve spaces and enforce 60 Unicode code points on create and update", () => {
  for (const [path, method] of [
    ["/api/requests", "POST"],
    ["/api/requests/{id}", "PATCH"],
  ]) {
    const payload = (title: string) =>
      method === "POST"
        ? { title, description: "Help", districtId: 1, role: "mentee" }
        : { title };
    for (const title of [
      "  Keep spaces  ",
      "😀".repeat(60),
      "e\u0301".repeat(30),
      " " + "x".repeat(59),
    ]) {
      const body = encode(payload(title));
      assert.equal(validateSensitiveBody(path, method, body), body);
    }
    for (const title of [
      "",
      "😀".repeat(61),
      "e\u0301".repeat(31),
      " " + "x".repeat(60),
      "\u0085\u001c\ufeff\t",
      "x\ud800",
      "x\udfff",
    ]) {
      assert.throws(
        () => validateSensitiveBody(path, method, encode(payload(title))),
        JSON.stringify(title),
      );
    }
  }
});

test("audience is a create-only enum and remains visible on request projections", () => {
  const payload = {
    title: "Question",
    description: "Help",
    districtId: 1,
    role: "mentee",
  };
  assert.doesNotThrow(() =>
    validateSensitiveBody("/api/requests", "POST", encode(payload)),
  );
  for (const audience of ["female", "male", "both"]) {
    assert.doesNotThrow(() =>
      validateSensitiveBody(
        "/api/requests",
        "POST",
        encode({ ...payload, audience }),
      ),
    );
    assert.throws(() =>
      validateSensitiveBody(
        "/api/requests/{id}",
        "PATCH",
        encode({ audience }),
      ),
    );
    const request = { ...requestFixture, audience };
    assert.deepEqual(
      projectPublicPayload(request, "/api/requests/{id}", "GET"),
      request,
    );
    assert.deepEqual(
      projectPublicPayload([request], "/api/request-activity", "GET"),
      [request],
    );
  }
  for (const audience of [null, "all", 1]) {
    assert.throws(() =>
      validateSensitiveBody(
        "/api/requests",
        "POST",
        encode({ ...payload, audience }),
      ),
    );
    assert.throws(() =>
      projectPublicPayload(
        { ...requestFixture, audience },
        "/api/requests/{id}",
        "GET",
      ),
    );
  }
  assert.deepEqual(
    projectPublicPayload(requestFixture, "/api/requests/{id}", "GET"),
    requestFixture,
  );
});

test("acceptance notifications retain their kind and signup demographics stay private", () => {
  const payload = {
    unreadCount: 1,
    items: [
      {
        id: 1,
        kind: "request_accepted",
        requestId: 1,
        message: "Accepted",
        createdAt: "2026-01-01T00:00:00Z",
        read: false,
      },
    ],
  };
  assert.deepEqual(
    projectPublicPayload(payload, "/api/notifications", "GET"),
    payload,
  );
  for (const path of ["/api/auth/register", "/api/auth/login"]) {
    assert.deepEqual(
      projectPublicPayload(
        {
          user: { ...userFixture, gender: "female", dateOfBirth: "2008-02-29" },
          message: "OK",
        },
        path,
        "POST",
      ),
      { user: userFixture, message: "OK" },
    );
  }
});

const unread = {
  unreadCount: 2,
  conversations: [{ conversationId: 1, unreadCount: 2 }],
};
const read = { conversationId: 1, unreadCount: 0 };
test("DM unread routes use student authority and bounded observed-message read bodies", () => {
  for (const [method, path] of [
    ["GET", "/api/dms/unread"],
    ["POST", "/api/dms/1/read"],
  ]) {
    const route = resolvePublicRoute(method, path);
    assert.ok(route);
    assert.equal(requiredAuthority(route), "student");
    assert.equal(route.family, "dms");
    assert.equal(route.authentication, "session");
    assert.throws(() => resolvePublicRoute(method, path + "?userId=2"));
  }
  for (const messageIds of [
    [1],
    [2147483647],
    Array.from({ length: 50 }, (_, index) => index + 1),
  ]) {
    assert.doesNotThrow(() =>
      validateSensitiveBody(
        "/api/dms/{id}/read",
        "POST",
        encode({ messageIds }),
      ),
    );
  }
  for (const payload of [
    {},
    { messageIds: [] },
    { messageIds: [1, 1] },
    { messageIds: [0] },
    { messageIds: [-1] },
    { messageIds: [1.5] },
    { messageIds: ["1"] },
    { messageIds: [true] },
    { messageIds: [2147483648] },
    { messageIds: null },
    { messageIds: 1 },
    { messageIds: Array.from({ length: 51 }, (_, index) => index + 1) },
    { messageIds: [1], userId: 2 },
    { throughMessageId: 1 },
    { messageIds: [1], throughMessageId: 1 },
  ]) {
    assert.throws(() =>
      validateSensitiveBody("/api/dms/{id}/read", "POST", encode(payload)),
    );
  }
});

test("DM count projections reject malformed counts and strip unrelated upstream fields", () => {
  assert.deepEqual(
    projectPublicPayload(
      {
        ...unread,
        secret: true,
        conversations: [{ ...unread.conversations[0], body: "private" }],
      },
      "/api/dms/unread",
      "GET",
    ),
    unread,
  );
  assert.deepEqual(
    projectPublicPayload(
      { ...read, secret: true },
      "/api/dms/{id}/read",
      "POST",
    ),
    read,
  );
  for (const unreadCount of [-1, 1.5, "1", null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() =>
      projectPublicPayload(
        { ...unread, unreadCount },
        "/api/dms/unread",
        "GET",
      ),
    );
    assert.throws(() =>
      projectPublicPayload(
        { ...read, unreadCount },
        "/api/dms/{id}/read",
        "POST",
      ),
    );
    assert.throws(() =>
      projectPublicPayload(
        { ...unread, conversations: [{ conversationId: 1, unreadCount }] },
        "/api/dms/unread",
        "GET",
      ),
    );
  }
  for (const conversationId of [0, -1, "1", 2147483648]) {
    assert.throws(() =>
      projectPublicPayload(
        { ...read, conversationId },
        "/api/dms/{id}/read",
        "POST",
      ),
    );
  }
  for (const payload of [
    null,
    [],
    { status: "todo", message: "Later" },
    { unreadCount: 0 },
  ]) {
    assert.throws(() =>
      projectPublicPayload(payload, "/api/dms/unread", "GET"),
    );
    assert.throws(() =>
      projectPublicPayload(payload, "/api/dms/{id}/read", "POST"),
    );
  }
});

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

test("DM unread HTTP endpoints require fresh student authority and exact success bodies", async (t) => {
  let identity: Record<string, unknown> = { ...userFixture };
  let status = 200;
  const forwarded: string[] = [];
  const upstream = createServer((req, res) => {
    const auth = req.url === "/api/auth/me";
    if (!auth) forwarded.push(req.method + " " + req.url);
    res.writeHead(auth ? 200 : status, { "content-type": "application/json" });
    res.end(
      JSON.stringify(
        auth ? identity : req.url === "/api/dms/unread" ? unread : read,
      ),
    );
  });
  const origin = "https://test.invalid";
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
  const call = (
    method: string,
    path: string,
    cookie = "session=synthetic",
    payload: unknown = { messageIds: [2] },
  ) =>
    fetch(base + path, {
      method,
      headers: {
        origin,
        cookie,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
    });
  const routes = [
    ["GET", "/api/dms/unread"],
    ["POST", "/api/dms/1/read"],
  ] as const;
  for (const [method, path] of routes) {
    const response = await call(method, path);
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), method === "GET" ? unread : read);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await call(method, path, "")).status, 401);
  }
  forwarded.length = 0;
  for (const flags of [
    { hasMemberAccess: false },
    { hasMemberAccess: "true" },
    { isAdmin: true },
    { id: 991, email: "admin@test.edu", isAdmin: true },
  ]) {
    identity = { ...userFixture, ...flags };
    for (const [method, path] of routes)
      assert.equal((await call(method, path)).status, 403, path);
  }
  assert.deepEqual(forwarded, []);
  identity = { ...userFixture };
  assert.equal(
    (
      await call("POST", "/api/dms/1/read", "session=synthetic", {
        messageIds: [2],
        userId: 2,
      })
    ).status,
    422,
  );
  assert.deepEqual(forwarded, []);
  for (status of [201, 204]) {
    for (const [method, path] of routes) {
      const response = await call(method, path);
      assert.equal(response.status, 502);
      assert.deepEqual(await response.json(), { error: "backend_error" });
    }
  }
});

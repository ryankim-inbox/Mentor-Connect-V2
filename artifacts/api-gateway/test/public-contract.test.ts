import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createGatewayServer } from "../src/gateway.ts";
import {
  publicError,
  projectStudentPayload,
  projectProfile,
  projectPublicPayload,
} from "../src/public-contract.ts";

test("public errors and learning failures never expose diagnostic canaries", () => {
  for (const [status, error] of [
    [400, "invalid_input"],
    [422, "invalid_input"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [429, "rate_limited"],
    [500, "backend_error"],
  ] as const)
    assert.deepEqual(publicError(status), { error });
  const todo = { status: "todo", mission: 7, message: "Complete Mission 7" };
  assert.deepEqual(projectStudentPayload(todo), todo);
  const failed = projectStudentPayload({
    success: false,
    source: "python",
    data: null,
    error: "postgresql connection failed with audit-canary",
    message: "DSN audit-canary",
    student_module: {
      module: "analysis",
      attempted_function: "weekly",
      status: "runtime error",
      error: "audit-canary",
      available_functions: ["weekly"],
    },
  }) as Record<string, unknown>;
  assert.equal(failed.success, false);
  assert.equal(failed.data, null);
  assert.equal(failed.source, "python");
  assert.equal(
    failed.message,
    "Student module returned an error. Check the named function.",
  );
  assert.ok(!JSON.stringify(failed).includes("audit-canary"));
  assert.deepEqual(
    projectStudentPayload({
      success: true,
      source: "adapter-fallback",
      data: [{ count: 3 }],
    }),
    { success: true, source: "adapter-fallback", data: [{ count: 3 }] },
  );
});
test("profile and admin projections remove private fields and reject malformed success", () => {
  const profile = {
    id: 2,
    name: "Other",
    subjects: ["Math"],
    createdAt: "2026-01-01T00:00:00",
    email: "audit-canary",
    bio: "audit-canary",
  };
  assert.deepEqual(projectProfile(profile, 2), {
    id: 2,
    name: "Other",
    subjects: ["Math"],
    createdAt: "2026-01-01T00:00:00",
  });
  assert.throws(() => projectProfile(profile, 3));
  assert.throws(() => projectProfile({ ...profile, createdAt: new Date() }, 2));
  const admin = projectPublicPayload(
    {
      ok: true,
      source: "adapter-fallback",
      student_module: null,
      student_result: { email: "audit-canary" },
      data: [
        {
          userId: 2,
          name: "Other",
          email: "audit-canary",
          district: "audit-canary",
          reportCount: 1,
          blockCount: 0,
          status: "warned",
          lastReportedAt: null,
          topReasons: ["spam"],
        },
      ],
    },
    "/api/admin/flagged-users",
    "GET",
  );
  assert.ok(!JSON.stringify(admin).includes("audit-canary"));
  assert.throws(() =>
    projectPublicPayload({ unexpected: true }, "/api/chat/rooms", "GET"),
  );
});
async function listen(s: Server) {
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as { port: number }).port}`;
}
test("real gateway strips HTTP error bodies/debug headers, preserves cookies and rejects bad successes", async (t) => {
  let status = 422;
  let payload: unknown = { detail: [{ input: "audit-canary" }] };
  const upstream = createServer((_q, r) => {
    r.writeHead(status, {
      "content-type": "application/json",
      "x-debug-sql": "audit-canary",
      "set-cookie": ["peerbridge_session=test; HttpOnly"],
    });
    r.end(JSON.stringify(payload));
  });
  const origin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin: origin,
    logger: { info() {} },
  });
  const url = await listen(gateway);
  t.after(() => {
    gateway.closeAllConnections();
    upstream.closeAllConnections();
    gateway.close();
    upstream.close();
  });
  for (const code of [422, 500]) {
    status = code;
    const r = await fetch(url + "/api/districts");
    assert.deepEqual(await r.json(), publicError(code));
    assert.equal(r.headers.get("x-debug-sql"), null);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(r.headers.get("set-cookie") || "", /peerbridge_session/);
  }
  status = 200;
  payload = "audit-canary";
  const r = await fetch(url + "/api/districts");
  assert.equal(r.status, 502);
  assert.ok(!(await r.text()).includes("audit-canary"));
});

test("gateway and generated response schemas agree on wire timestamp fixtures", async () => {
  const { GetUserResponse, ListChatRoomMessagesResponse } =
    await import("../../../lib/api-zod/src/generated/api.ts");
  const good = {
    id: 2,
    name: "Other",
    subjects: ["Math"],
    createdAt: "2026-01-01T00:00:00",
  };
  for (const fixture of [
    good,
    { ...good, createdAt: new Date() },
    { ...good, subjects: "Math" },
    { ...good, name: "" },
  ]) {
    assert.equal(
      GetUserResponse.safeParse(fixture).success,
      (() => {
        try {
          projectProfile(fixture, 2);
          return true;
        } catch {
          return false;
        }
      })(),
    );
  }
  const messages = [
    {
      id: 1,
      roomId: 1,
      senderId: 2,
      senderName: "Other",
      body: "hello",
      createdAt: "2026-01-01T00:00:00",
    },
  ];
  const generated = ListChatRoomMessagesResponse.parse(
    messages,
  ) as typeof messages;
  assert.equal(typeof generated[0]?.createdAt, "string");
  assert.deepEqual(
    projectPublicPayload(messages, "/api/chat/rooms/{id}/messages", "GET"),
    generated,
  );
});

test("message POST schemas accept implemented messages and distinct scaffold TODOs", async () => {
  const generated = await import("../../../lib/api-zod/src/generated/api.ts");
  const { chatMessageFixture, dmMessageFixture } =
    await import("./contract-fixtures.ts");
  for (const [path, validator, message] of [
    [
      "/api/chat/rooms/{id}/messages",
      generated.SendChatRoomMessageResponse,
      chatMessageFixture,
    ],
    [
      "/api/dms/{id}/messages",
      generated.SendDmMessageResponse,
      dmMessageFixture,
    ],
  ] as const)
    for (const fixture of [
      message,
      { status: "todo", mission: 7, message: "Complete Mission 7" },
    ]) {
      assert.deepEqual(
        validator.parse(fixture),
        projectPublicPayload(fixture, path, "POST"),
      );
    }
});

test("learning TODO status preserves failed state and sanitizes its diagnostic message", async () => {
  const { GetPracticeRawModuleResponse } =
    await import("../../../lib/api-zod/src/generated/api.ts");
  const fixture = {
    success: false,
    status: "todo",
    message: "audit-canary",
    feature: "raw",
    module_name: "locations",
    available_functions: [],
    is_todo: true,
    is_real: false,
    data: null,
    source: "python",
  };
  assert.ok(GetPracticeRawModuleResponse.safeParse(fixture).success);
  assert.deepEqual(
    projectPublicPayload(fixture, "/api/practice/raw/{moduleName}", "GET"),
    {
      ...fixture,
      message: "Student module returned an error. Check the named function.",
    },
  );
});

test("nested student-module TODO metadata does not require a chat scaffold message", () => {
  const fixture = {
    ok: false,
    success: false,
    source: "python",
    data: null,
    student_module: {
      module: "analysis",
      attempted_function: "weekly",
      status: "todo",
      error: "audit-canary",
      available_functions: ["weekly"],
    },
  };
  assert.deepEqual(
    projectPublicPayload(fixture, "/api/analysis/status", "GET"),
    {
      ...fixture,
      student_module: {
        ...fixture.student_module,
        error: "student_module_error",
      },
    },
  );
});

test("each ordinary wire-model family agrees with generated validation and rejects malformed HTTP successes", async (t) => {
  const g = await import("../../../lib/api-zod/src/generated/api.ts");
  const f = await import("./contract-fixtures.ts");
  const cases = [
    {
      path: "/api/auth/me",
      method: "GET",
      schema: g.GetMeResponse,
      good: f.userFixture,
      bad: { id: 1 },
    },
    {
      path: "/api/auth/login",
      method: "POST",
      schema: g.LoginResponse,
      good: { user: f.userFixture, message: "Logged in" },
      bad: { user: f.userFixture },
    },
    {
      path: "/api/auth/logout",
      method: "POST",
      schema: g.LogoutResponse,
      good: { message: "Logged out" },
      bad: { message: 3 },
    },
    {
      path: "/api/districts",
      method: "GET",
      schema: g.ListDistrictsResponse,
      good: [f.districtFixture],
      bad: [{ ...f.districtFixture, county: null }],
    },
    {
      path: "/api/tags",
      method: "GET",
      schema: g.ListTagsResponse,
      good: [f.tagFixture],
      bad: [{ ...f.tagFixture, color: 7 }],
    },
    {
      path: "/api/requests",
      method: "GET",
      schema: g.ListRequestsResponse,
      good: [f.requestFixture],
      bad: [{ ...f.requestFixture, tags: [{ id: 1 }] }],
    },
    {
      path: "/api/blocks",
      method: "GET",
      schema: g.ListBlocksResponse,
      good: [f.blockFixture],
      bad: [{ ...f.blockFixture, createdAt: new Date() }],
    },
    {
      path: "/api/stats/overview",
      method: "GET",
      schema: g.GetStatsOverviewResponse,
      good: f.overviewFixture,
      bad: {},
    },
    {
      path: "/api/stats/district/{id}",
      method: "GET",
      schema: g.GetDistrictStatsResponse,
      good: f.districtStatsFixture,
      bad: { ...f.districtStatsFixture, mentorCount: "one" },
    },
    {
      path: "/api/healthz",
      method: "GET",
      schema: g.HealthCheckResponse,
      good: { status: "ok" },
      bad: { status: false },
    },
  ];
  let target: (typeof cases)[number] = cases[0]!;
  const upstream = createServer((q, r) => {
    r.writeHead(200, { "content-type": "application/json" });
    r.end(
      JSON.stringify(
        q.url === "/api/auth/me" && target.path !== "/api/auth/me"
          ? f.userFixture
          : target.bad,
      ),
    );
  });
  const origin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin: origin,
    logger: { info() {} },
  });
  const url = await listen(gateway);
  t.after(() => {
    gateway.closeAllConnections();
    upstream.closeAllConnections();
    gateway.close();
    upstream.close();
  });
  for (const c of cases) {
    target = c;
    assert.ok(c.schema.safeParse(c.good).success, `${c.path} generated good`);
    assert.deepEqual(
      projectPublicPayload(c.good, c.path, c.method),
      c.schema.parse(c.good),
      `${c.path} good projection`,
    );
    assert.equal(
      c.schema.safeParse(c.bad).success,
      false,
      `${c.path} generated bad`,
    );
    assert.throws(
      () => projectPublicPayload(c.bad, c.path, c.method),
      `${c.path} malformed must be rejected`,
    );
    // A Date is invalid as an in-memory wire value but serializes to a valid JSON string.
    if (c.path === "/api/blocks")
      target = { ...c, bad: [{ ...f.blockFixture, createdAt: 17 }] };
    const r = await fetch(url + c.path.replace("{id}", "1"), {
      method: c.method,
      headers: {
        cookie: "peerbridge_session=fixture",
        ...(c.path === "/api/auth/login"
          ? { "content-type": "application/json" }
          : {}),
      },
      ...(c.path === "/api/auth/login"
        ? {
            body: JSON.stringify({
              email: "student@example.edu",
              password: "fixture-password",
            }),
          }
        : {}),
    });
    assert.equal(r.status, 502, `${c.path} malformed HTTP success`);
    assert.deepEqual(await r.json(), { error: "backend_error" });
  }
});

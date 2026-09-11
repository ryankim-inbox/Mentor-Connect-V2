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

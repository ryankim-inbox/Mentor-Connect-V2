import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import { createGatewayServer } from "../src/gateway.ts";
import { userFixture } from "./contract-fixtures.ts";
import { projectPublicPayload } from "../src/public-contract.ts";

const origin = "https://test.invalid";
async function listen(server: Server) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
test("fresh authority flags gate member/admin routes and special profiles", async (t) => {
  let identity: Record<string, unknown> = { id: 1 };
  const calls: string[] = [];
  const upstream = createServer((req, res) => {
    calls.push(req.url!);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/api/auth/me"
          ? identity
          : req.url === "/api/users/1"
            ? userFixture
            : req.url!.startsWith("/api/users/")
              ? {
                  id: Number(req.url!.split("/").at(-1)),
                  name: "Student",
                  subjects: [],
                  createdAt: "2026-01-01T00:00:00Z",
                }
              : [],
      ),
    );
  });
  const upstreamOrigin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin,
    publicOrigin: origin,
    logger: { info() {} },
  });
  const base = await listen(gateway);
  t.after(async () => {
    for (const s of [gateway, upstream]) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
  const get = (path: string) =>
    fetch(base + path, { headers: { cookie: "session=synthetic" } });
  for (const flags of [
    {},
    { isVerified: false, isAdmin: true },
    { isVerified: "true", isAdmin: true },
  ]) {
    identity = { id: 1, ...flags };
    for (const path of [
      "/api/tags",
      "/api/mentors",
      "/api/districts/1",
      "/api/stats/district/1",
      "/api/admin/reports",
      "/api/users/2",
    ])
      assert.equal((await get(path)).status, 403, JSON.stringify(flags) + path);
    assert.equal((await get("/api/users/1")).status, 200);
  }
  identity = { id: 1, isVerified: true, isAdmin: false };
  assert.equal((await get("/api/mentors")).status, 200);
  assert.equal((await get("/api/users/2")).status, 200);
  for (const path of [
    "/api/admin/reports",
    "/api/admin/flagged-users",
    "/api/practice/status",
    "/api/matches/1",
    "/api/analytics/weekly-matches",
    "/api/scheduling/status",
    "/api/python-reports/status",
    "/api/analysis/status",
  ])
    assert.equal((await get(path)).status, 403, path);
  identity = { id: 1, isVerified: true, isAdmin: true };
  assert.equal((await get("/api/admin/reports")).status, 200);
  identity = { id: 1, isVerified: false, isAdmin: false };
  assert.equal((await get("/api/admin/reports")).status, 403);
});

test("sensitive bodies reject forged claims before upstream and never expose tokens", async (t) => {
  const calls: string[] = [];
  const logs: unknown[] = [];
  const upstream = createServer((req, res) => {
    calls.push(req.url!);
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/api/auth/me"
          ? { id: 1, isVerified: true, isAdmin: true }
          : { message: "sent" },
      ),
    );
  });
  const gateway = createGatewayServer({
    upstreamOrigin: await listen(upstream),
    publicOrigin: origin,
    logger: {
      info(_e, f) {
        logs.push(f);
      },
    },
  });
  const base = await listen(gateway);
  t.after(async () => {
    for (const s of [gateway, upstream]) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
  const token = "SENSITIVE_TOKEN_" + "a".repeat(43);
  for (const [path, method, payload] of [
    ["/api/auth/verification/confirm", "POST", { token, isAdmin: true }],
    ["/api/auth/verification/confirm", "POST", { token: "short" }],
    ["/api/admin/reports/1", "PATCH", { status: "resolved", reviewedBy: 2 }],
    [
      "/api/admin/reports/1",
      "PATCH",
      { status: "resolved", note: "a".repeat(2001) },
    ],
    ["/api/requests/1/comments/2", "PATCH", { body: "hello", authorId: 2 }],
    ["/api/requests/1/comments", "POST", { body: "hello", authorId: 2 }],
    ["/api/reports", "POST", { reportedUserId: 2, reason: "bogus" }],
    ["/api/chat/rooms/1/messages", "POST", { body: "hi", senderId: 2 }],
    ["/api/matches", "POST", { questionId: 1, isAdmin: true }],
  ] as const) {
    const response = await fetch(base + path, {
      method,
      headers: {
        cookie: "session=synthetic",
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 422, path);
    assert.doesNotMatch(await response.text(), /SENSITIVE_TOKEN/);
  }
  const blank = await fetch(base + "/api/chat/rooms/1/messages", {
    method: "POST",
    headers: {
      cookie: "session=synthetic",
      origin,
      "content-type": "application/json",
    },
    body: JSON.stringify({ body: " " }),
  });
  assert.equal(blank.status, 400, "chat content errors preserve backend400");
  assert.ok(calls.every((p) => p === "/api/auth/me"));
  assert.doesNotMatch(JSON.stringify(logs), /SENSITIVE_TOKEN/);
  for (let i = 0; i < 2; i++) {
    const response = await fetch(base + "/api/auth/verification/request", {
      method: "POST",
      headers: { cookie: "session=synthetic", origin },
    });
    assert.equal(response.status, i === 0 ? 200 : 429);
    if (i) assert.ok(response.headers.get("retry-after"));
  }
});

test("new projections retain trust, moderation and tombstones while stripping secrets", () => {
  const comment = {
    id: 1,
    requestId: 1,
    authorId: 1,
    authorName: "A",
    parentId: null,
    parentAuthorName: null,
    body: "",
    createdAt: "today",
    updatedAt: null,
    deletedAt: "today",
    token: "secret",
  };
  assert.deepEqual(
    projectPublicPayload(
      comment,
      "/api/requests/{id}/comments/{commentId}",
      "DELETE",
    ),
    Object.fromEntries(Object.entries(comment).filter(([k]) => k !== "token")),
  );
  const mentor = {
    id: 1,
    name: "A",
    role: "mentor",
    subjects: [],
    districtId: 1,
    districtName: "School",
    bio: null,
    email: "secret",
    isAdmin: true,
  };
  const directory = projectPublicPayload(
    [mentor],
    "/api/mentors",
    "GET",
  ) as Record<string, unknown>[];
  assert.equal(Object.keys(directory[0]!).length, 7);
  assert.equal(directory[0]!.email, undefined);
});

test("generated trust schemas match gateway public models and enforce bounded fields", async () => {
  const api = await import("../../../lib/api-zod/src/generated/api.ts");
  const user = { ...userFixture, isVerified: false, isAdmin: false };
  assert.equal(
    api.ConfirmEmailVerificationResponse.safeParse(user).success,
    true,
  );
  for (const field of ["isVerified", "isAdmin"]) {
    const incomplete: Record<string, unknown> = { ...user };
    delete incomplete[field];
    assert.equal(
      api.ConfirmEmailVerificationResponse.safeParse(incomplete).success,
      false,
    );
  }
  for (const token of ["a".repeat(42), "a".repeat(129), "?".repeat(43)])
    assert.equal(
      api.ConfirmEmailVerificationBody.safeParse({ token }).success,
      false,
    );
  assert.equal(
    api.ConfirmEmailVerificationBody.safeParse({ token: "a".repeat(43) })
      .success,
    true,
  );
  const mentor = {
    id: 501,
    name: "Mentor",
    role: "both",
    subjects: [],
    districtId: 1,
    districtName: "School",
    bio: null,
  };
  const report = {
    id: 1,
    reporterId: 1,
    reporterName: "Student",
    reportedUserId: 501,
    reportedUserName: "Mentor",
    reason: "other",
    description: null,
    status: "open",
    note: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
  const comment = {
    id: 1,
    requestId: 1,
    authorId: 1,
    authorName: "Student",
    parentId: null,
    parentAuthorName: null,
    body: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: null,
    deletedAt: "2026-01-02",
  };
  for (const [path, value, schema] of [
    ["/api/mentors", [mentor], api.ListMentorsResponse],
    ["/api/admin/reports", [report], api.ListAdminReportsResponse],
    ["/api/admin/reports/{id}", report, api.ModerateReportResponse],
    [
      "/api/requests/{id}/comments/{commentId}",
      comment,
      api.DeleteRequestCommentResponse,
    ],
  ] as const) {
    assert.equal(schema.safeParse(value).success, true, path);
    assert.deepEqual(projectPublicPayload(value, path, "DELETE"), value);
  }
  for (const query of [{ limit: 0 }, { limit: 51 }, { beforeId: 2147483648 }]) {
    assert.equal(api.ListMentorsQueryParams.safeParse(query).success, false);
    assert.equal(
      api.ListAdminReportsQueryParams.safeParse(query).success,
      false,
    );
  }
  assert.equal(
    api.ModerateReportBody.safeParse({ status: "closed" }).success,
    false,
  );
  assert.equal(
    api.ModerateReportBody.safeParse({
      status: "resolved",
      note: "a".repeat(2001),
    }).success,
    false,
  );
  assert.equal(
    api.EditRequestCommentBody.safeParse({ body: "a".repeat(2001) }).success,
    false,
  );
});

test("confirmation throttling uses account identity across distinct tokens and redacts successful responses", async (t) => {
  const logs: unknown[] = [];
  let confirmations = 0;
  const upstream = createServer((req, res) => {
    if (req.url === "/api/auth/verification/confirm") confirmations++;
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        ...userFixture,
        verificationToken: "sensitive-response-token",
      }),
    );
  });
  const gateway = createGatewayServer({
    upstreamOrigin: await listen(upstream),
    publicOrigin: origin,
    logger: {
      info(_e, f) {
        logs.push(f);
      },
    },
  });
  const base = await listen(gateway);
  t.after(async () => {
    for (const s of [gateway, upstream]) {
      s.closeAllConnections();
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
  for (let i = 0; i < 11; i++) {
    const token = `sensitive-token-${i}-` + "a".repeat(43);
    const response = await fetch(base + "/api/auth/verification/confirm", {
      method: "POST",
      headers: {
        origin,
        cookie: "session=synthetic",
        "content-type": "application/json",
      },
      body: JSON.stringify({ token }),
    });
    assert.equal(response.status, i === 10 ? 429 : 200);
    assert.doesNotMatch(await response.text(), /sensitive/);
    if (i === 10) assert.ok(response.headers.get("retry-after"));
  }
  assert.equal(confirmations, 10);
  assert.doesNotMatch(JSON.stringify(logs), /sensitive/);
});

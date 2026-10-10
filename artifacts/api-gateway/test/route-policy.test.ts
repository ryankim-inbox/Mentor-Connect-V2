import assert from "node:assert/strict";
import test from "node:test";

import { ListDistrictsQueryParams } from "../../../lib/api-zod/src/generated/api.js";

import { publicRoutes, resolvePublicRoute } from "../src/route-policy.js";

test("registers the complete 48-operation REST contract", () => {
  assert.equal(publicRoutes.length, 48);
  assert.equal(
    publicRoutes.filter((route) => route.authentication === "cookie").length,
    1,
  );
  assert.equal(
    publicRoutes.find((route) => route.template === "/api/auth/me")
      ?.authentication,
    "cookie",
  );
});

test("resolves every operation in the approved REST contract", () => {
  const operations = [
    ["POST", "/api/auth/register"],
    ["POST", "/api/auth/login"],
    ["POST", "/api/auth/logout"],
    ["GET", "/api/auth/me"],
    ["GET", "/api/users/1"],
    ["PATCH", "/api/users/1"],
    ["GET", "/api/districts?type=high_school&search=North"],
    ["GET", "/api/districts/1"],
    ["GET", "/api/tags"],
    ["GET", "/api/requests?districtId=1&role=mentor&status=open&tagId=2"],
    ["POST", "/api/requests"],
    ["GET", "/api/requests/1"],
    ["PATCH", "/api/requests/1"],
    ["DELETE", "/api/requests/1"],
    ["POST", "/api/requests/1/match"],
    ["POST", "/api/reports"],
    ["GET", "/api/blocks"],
    ["POST", "/api/blocks"],
    ["DELETE", "/api/blocks/1"],
    ["GET", "/api/stats/overview"],
    ["GET", "/api/stats/district/1"],
    ["GET", "/api/matches/1?limit=20"],
    ["POST", "/api/matches"],
    ["GET", "/api/chat/rooms"],
    ["GET", "/api/chat/rooms/1/messages"],
    ["POST", "/api/chat/rooms/1/messages"],
    ["GET", "/api/dms"],
    ["POST", "/api/dms/start"],
    ["GET", "/api/dms/1/messages"],
    ["POST", "/api/dms/1/messages"],
    ["GET", "/api/practice/status"],
    ["GET", "/api/practice/matching/1?limit=1"],
    ["GET", "/api/practice/locations/status"],
    ["POST", "/api/practice/locations/test"],
    ["GET", "/api/practice/blocks/status"],
    ["GET", "/api/practice/raw/find_matches"],
    ["GET", "/api/analysis/status"],
    ["GET", "/api/analytics/weekly-matches"],
    ["GET", "/api/analytics/popular-subjects"],
    ["GET", "/api/analytics/popular-time-slots"],
    ["GET", "/api/analytics/mentor-response-rates"],
    ["GET", "/api/python-reports/status"],
    ["GET", "/api/python-reports/summary"],
    ["GET", "/api/scheduling/status"],
    ["GET", "/api/scheduling/overview"],
    ["GET", "/api/scheduling/suggest?user_a=1&user_b=2"],
    ["GET", "/api/admin/flagged-users"],
    ["GET", "/api/healthz"],
  ] as const;

  for (const [method, target] of operations) {
    assert.ok(resolvePublicRoute(method, target), `${method} ${target}`);
  }
});

test("resolves literal and parameterized learning routes", () => {
  assert.equal(
    resolvePublicRoute("GET", "/api/requests?status=open&districtId=2")
      ?.upstreamPath,
    "/api/requests?status=open&districtId=2",
  );
  assert.equal(
    resolvePublicRoute("DELETE", "/api/requests/2")?.family,
    "requests",
  );
  assert.equal(
    resolvePublicRoute("GET", "/api/practice/matching/1?limit=5")?.family,
    "practice",
  );
  assert.equal(
    resolvePublicRoute("GET", "/api/scheduling/suggest?user_a=1&user_b=2")
      ?.family,
    "scheduling",
  );
  assert.equal(resolvePublicRoute("GET", "/api/not-a-route"), undefined);
  assert.throws(
    () => resolvePublicRoute("GET", "/api/requests?status=open&status=closed"),
    /invalid_query/,
  );
});

test("preserves validated encoded query values using canonical serialization", () => {
  assert.equal(
    resolvePublicRoute(
      "GET",
      "/api/districts?search=San%20Jos%C3%A9&type=unified",
    )?.upstreamPath,
    "/api/districts?search=San+Jos%C3%A9&type=unified",
  );
  assert.equal(
    resolvePublicRoute("GET", "/api/requests")?.upstreamPath,
    "/api/requests",
  );
});

test("rejects malformed, duplicate, unknown, and route-specific invalid query values", () => {
  const invalidTargets = [
    "/api/districts?search=%ZZ",
    "/api/districts?unknown=1",
    "/api/requests?districtId=0",
    "/api/requests?districtId=01",
    "/api/requests?tagId=9007199254740992",
    "/api/requests?role=admin",
    "/api/requests?status=pending",
    "/api/matches/1?limit=0",
    "/api/matches/1?limit=21",
    "/api/districts?type=county",
    "/api/districts?search=" + "é".repeat(101),
    "/api/scheduling/suggest?user_a=1",
    "/api/scheduling/suggest?user_b=2",
    "/api/scheduling/suggest?user_a=1&user_b=2&user_b=3",
  ];

  for (const target of invalidTargets) {
    assert.throws(
      () => resolvePublicRoute("GET", target),
      /invalid_query/,
      target,
    );
  }
});

test("accepts only canonical positive safe identifiers and raw module names", () => {
  assert.equal(resolvePublicRoute("GET", "/api/users/1")?.resourceId, 1);
  assert.equal(
    resolvePublicRoute("GET", "/api/practice/raw/find_matches")?.family,
    "practice",
  );
  assert.equal(resolvePublicRoute("GET", "/api/users/0"), undefined);
  assert.equal(resolvePublicRoute("GET", "/api/users/01"), undefined);
  assert.equal(
    resolvePublicRoute("GET", "/api/users/9007199254740992"),
    undefined,
  );
  assert.equal(
    resolvePublicRoute("GET", "/api/practice/raw/not_a_module"),
    undefined,
  );
  assert.equal(resolvePublicRoute("POST", "/api/healthz"), undefined);
});

test("request paging accepts 50 while matching retains its separate 20 limit", () => {
  const before = "2026-10-10T12:30:45.123456+05:30|123";
  const query = new URLSearchParams({ limit: "50", before });
  assert.equal(resolvePublicRoute("GET", `/api/requests?${query}`)?.upstreamPath, `/api/requests?${query}`);
  for (const path of ["/api/matches/1?limit=20", "/api/practice/matching/1?limit=20"])
    assert.ok(resolvePublicRoute("GET", path));
  for (const value of ["0", "51", "01", "1.5"])
    assert.throws(() => resolvePublicRoute("GET", `/api/requests?limit=${value}`), /invalid_query/);
  for (const value of ["", "bad", "2026-10-10T00:00:00|1", "2026-02-30T00:00:00Z|1",
    "2026-10-10T24:00:00Z|1", "2026-10-10T00:00:00+25:00|1", "2026-10-10T00:00:00Z|0",
    "2026-10-10T00:00:00Z|01", "2026-10-10T00:00:00Z|9007199254740992", "x".repeat(97)]) {
    assert.throws(() => resolvePublicRoute("GET", `/api/requests?${new URLSearchParams({ before: value })}`), /invalid_query/, value);
  }
  assert.throws(() => resolvePublicRoute("GET", `/api/requests?before=${encodeURIComponent(before)}&before=${encodeURIComponent(before)}`), /invalid_query/);
  for (const path of ["/api/matches/1?limit=21", "/api/practice/matching/1?limit=21"])
    assert.throws(() => resolvePublicRoute("GET", path), /invalid_query/);
});

for (const [type, accepted] of [[undefined, true], ["high_school", true], ["unified", true], ["all", false], ["elementary", false]] as const) {
  test(`generated and gateway district filters agree for ${type ?? "omitted"}`, () => {
    const query = type === undefined ? {} : { type };
    assert.equal(ListDistrictsQueryParams.safeParse(query).success, accepted);
    const path = `/api/districts?${new URLSearchParams(query)}`;
    if (accepted) assert.ok(resolvePublicRoute("GET", path));
    else assert.throws(() => resolvePublicRoute("GET", path), /invalid_query/);
  });
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  QUARANTINED_ROUTE_FAMILIES,
  classifyQuarantinedRoute,
  normalizeInboundPath,
} from "../src/route-policy.js";

test("normalizes encoded, matrix, dot-segment, slash, and case variants", () => {
  const adminTargets = [
    "/api/admin",
    "/api/admin/",
    "/api/admin/flagged-users",
    "/api/admin%2Fflagged-users",
    "/api/admin%252Fflagged-users",
    "/api/a%64min/flagged-users",
    "/api//admin//flagged-users",
    "/api/safe/../admin/flagged-users",
    "/api/admin;version=1/flagged-users",
    "/API/ADMIN/FLAGGED-USERS",
    "/api%5cadmin%5cflagged-users",
  ];

  for (const target of adminTargets) {
    assert.equal(classifyQuarantinedRoute(target), QUARANTINED_ROUTE_FAMILIES.admin, target);
  }

  const reportTargets = [
    "/api/python-reports",
    "/api/python-reports/",
    "/api/python-reports%2Fsummary",
    "/api/python%2Dreports/summary",
    "/api/python-reports;preview=true/summary",
    "/api/one/../python-reports/status",
  ];

  for (const target of reportTargets) {
    assert.equal(classifyQuarantinedRoute(target), QUARANTINED_ROUTE_FAMILIES.pythonReports, target);
  }

  const matchTargets = [
    "/api/matches",
    "/api/matches/",
    "/api/matches/42",
    "/api/matches%2F42",
    "/api/matches%252F42",
    "/API/MATCHES/42",
    "/api/matches;preview=true/42",
    "/api/safe/../matches/42",
  ];

  for (const target of matchTargets) {
    assert.equal(classifyQuarantinedRoute(target), QUARANTINED_ROUTE_FAMILIES.matches, target);
  }

  const practiceTargets = [
    "/api/practice",
    "/api/practice/",
    "/api/practice/matching/42?limit=1000",
    "/api/practice%2Fmatching%2F42",
    "/api/practice%252Fmatching%252F42",
    "/API/PRACTICE/MATCHING/42",
    "/api/practice;preview=true/matching/42",
    "/api/safe/../practice/matching/42",
  ];

  for (const target of practiceTargets) {
    assert.equal(classifyQuarantinedRoute(target), QUARANTINED_ROUTE_FAMILIES.practice, target);
  }

  const requestMatchTargets = [
    "/api/requests/42/match",
    "/api/requests/42/match/",
    "/api/requests/blocked-mentor/match",
    "/api/requests%2F42%2Fmatch",
    "/api/requests%252F42%252Fmatch",
    "/API/REQUESTS/42/MATCH",
    "/api/requests/42;preview=true/match",
    "/api/requests/safe/../42/match",
    "/api/requests/42/match/extra",
  ];

  for (const target of requestMatchTargets) {
    assert.equal(
      classifyQuarantinedRoute(target),
      QUARANTINED_ROUTE_FAMILIES.requestMatch,
      target,
    );
  }
});

test("rejects malformed percent encodings before they can be proxied", () => {
  assert.equal(normalizeInboundPath("/api/admin%2"), undefined);
  assert.equal(normalizeInboundPath("/api/%25"), undefined);
  assert.equal(normalizeInboundPath("/api/%00admin"), undefined);
});

test("does not over-block neighboring route names", () => {
  assert.equal(classifyQuarantinedRoute("/api/administrator/flagged-users"), undefined);
  assert.equal(classifyQuarantinedRoute("/api/python-reports-archive"), undefined);
  assert.equal(classifyQuarantinedRoute("/api/matches-archive/42"), undefined);
  assert.equal(classifyQuarantinedRoute("/api/practice-data/matching/42"), undefined);
  assert.equal(classifyQuarantinedRoute("/api/requests/42/matching"), undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import { requestTitleError, requestTitleLength } from "../src/lib/request-title";
test("title limit counts raw Unicode code points including whitespace", () => {
  for (const ch of ["a", "가", "😀", "𐐀"]) {
    for (const n of [59, 60]) assert.equal(requestTitleError(ch.repeat(n)), null);
    assert.ok(requestTitleError(ch.repeat(61)));
    assert.equal(requestTitleLength(ch.repeat(60)), 60);
  }
  assert.equal(requestTitleError(" " + "a".repeat(59)), null);
  assert.ok(requestTitleError(" " + "a".repeat(60)));
  assert.equal(requestTitleLength("e\u0301"), 2);
  assert.equal(requestTitleError("e\u0301".repeat(30)), null);
  assert.ok(requestTitleError("e\u0301".repeat(30) + "x"));
  for (const blank of ["", " ", "\ufeff", "\u0085", "\u001c"]) assert.ok(requestTitleError(blank));
  for (const invalid of ["\ud800", "\udfff", "valid\ud800"]) assert.ok(requestTitleError(invalid));
});

import { CreateRequestBody, RegisterBody } from "../../../lib/api-zod/src/generated/api";
test("generated contract uses the same code-point limits instead of UTF-16 lengths", () => {
  const request = { districtId: 1, role: "mentee", description: "Synthetic", audience: "both" };
  for (const count of [59, 60, 61]) {
    assert.equal(CreateRequestBody.safeParse({ ...request, title: "😀".repeat(count) }).success, count <= 60);
  }
  const signup = { email: "synthetic@test.edu", name: "Synthetic", role: "mentee", districtId: 1, gender: "female", dateOfBirth: "2008-02-29" };
  assert.equal(RegisterBody.safeParse({ ...signup, password: "A!" + "😀".repeat(9) }).success, false);
  assert.equal(RegisterBody.safeParse({ ...signup, password: "A!" + "😀".repeat(10) }).success, true);
});

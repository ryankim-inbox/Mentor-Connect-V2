import assert from "node:assert/strict";
import test from "node:test";
import { validateSensitiveBody } from "../src/request-controls.ts";
import { projectPublicPayload } from "../src/public-contract.ts";
import * as generated from "../../../lib/api-zod/src/generated/api.ts";

const uuid = "00000000-0000-4000-8000-000000000001";
const comment = (body: string) => ({
  id: 1,
  requestId: 1,
  authorId: 1,
  authorName: "Student",
  parentId: null,
  parentAuthorName: null,
  body,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: null,
  deletedAt: null,
});
const report = (description: string, note: string | null = null) => ({
  id: 1,
  reporterId: 1,
  reporterName: "Student",
  reportedUserId: 501,
  reportedUserName: "Mentor",
  targetType: "profile",
  requestId: null,
  requestTitle: null,
  reason: "other",
  description,
  status: "reviewing",
  note,
  reviewedBy: 501,
  reviewedAt: "2026-01-01T00:00:00Z",
  createdAt: "2026-01-01T00:00:00Z",
});
const mutations = [
  [
    "/api/requests/{id}/comments",
    "POST",
    (v: string) => ({ body: v, clientCommentId: uuid }),
    generated.CreateRequestCommentBody,
  ],
  [
    "/api/requests/{id}/comments/{commentId}",
    "PATCH",
    (v: string) => ({ body: v }),
    generated.EditRequestCommentBody,
  ],
  [
    "/api/reports",
    "POST",
    (v: string) => ({ reportedUserId: 501, reason: "other", description: v }),
    generated.CreateReportBody,
  ],
  [
    "/api/admin/reports/{id}",
    "PATCH",
    (v: string) => ({ status: "reviewing", note: v }),
    generated.ModerateReportBody,
  ],
] as const;

for (const [path, method, payload, schema] of mutations) {
  test(`gateway and generated ${path} count Unicode code points`, () => {
    for (const value of [
      "😀".repeat(1001),
      "\u{10400}".repeat(2000),
      "a".repeat(1000) + "😀".repeat(1000),
      "😀".repeat(1999) + "\n",
    ]) {
      assert.doesNotThrow(() =>
        validateSensitiveBody(
          path,
          method,
          Buffer.from(JSON.stringify(payload(value))),
        ),
      );
      assert.equal(schema.safeParse(payload(value)).success, true);
    }
    for (const value of [
      "😀".repeat(2001),
      "a".repeat(2001),
      "😀".repeat(2000) + "\n",
    ]) {
      assert.throws(() =>
        validateSensitiveBody(
          path,
          method,
          Buffer.from(JSON.stringify(payload(value))),
        ),
      );
      assert.equal(schema.safeParse(payload(value)).success, false);
    }
  });
}

test("comment response projections and generated schemas preserve astral at the limit", () => {
  for (const value of ["😀".repeat(1001), "😀".repeat(2000)]) {
    const row = comment(value);
    for (const [path, method, payload, schema] of [
      [
        "/api/requests/{id}/comments",
        "GET",
        [row],
        generated.ListRequestCommentsResponse,
      ],
      [
        "/api/requests/{id}/comments",
        "POST",
        row,
        generated.CreateRequestCommentResponse,
      ],
      [
        "/api/requests/{id}/comments/{commentId}",
        "PATCH",
        row,
        generated.EditRequestCommentResponse,
      ],
      [
        "/api/requests/{id}/comments/{commentId}",
        "DELETE",
        row,
        generated.DeleteRequestCommentResponse,
      ],
    ] as const) {
      assert.deepEqual(projectPublicPayload(payload, path, method), payload);
      assert.equal(schema.safeParse(payload).success, true);
    }
  }
  assert.throws(() =>
    projectPublicPayload(
      comment("😀".repeat(2001)),
      "/api/requests/{id}/comments/{commentId}",
      "PATCH",
    ),
  );
  assert.equal(
    generated.EditRequestCommentResponse.safeParse(comment("😀".repeat(2001)))
      .success,
    false,
  );
});

test("admin list and moderation retain legacy evidence and code-point-bounded notes", () => {
  for (const description of [
    "😀".repeat(2000),
    "a".repeat(4001),
    "😀".repeat(3001),
  ]) {
    const row = report(description, "😀".repeat(2000));
    assert.deepEqual(projectPublicPayload([row], "/api/admin/reports", "GET"), [
      row,
    ]);
    assert.deepEqual(
      projectPublicPayload(row, "/api/admin/reports/{id}", "PATCH"),
      row,
    );
    assert.equal(
      generated.ListAdminReportsResponse.safeParse([row]).success,
      true,
    );
    assert.equal(generated.ModerateReportResponse.safeParse(row).success, true);
  }
  const row = report("Legacy evidence", "😀".repeat(2001));
  assert.throws(() =>
    projectPublicPayload(row, "/api/admin/reports/{id}", "PATCH"),
  );
  assert.equal(generated.ModerateReportResponse.safeParse(row).success, false);
});

test("request title and description keep independent UTF-8 byte limits", () => {
  const payload = {
    districtId: 1,
    role: "mentee",
    title: "😀".repeat(50),
    description: "😀".repeat(1000),
  };
  assert.doesNotThrow(() =>
    validateSensitiveBody(
      "/api/requests",
      "POST",
      Buffer.from(JSON.stringify(payload)),
    ),
  );
  for (const invalid of [
    { ...payload, title: "😀".repeat(51) },
    { ...payload, description: "😀".repeat(1001) },
  ])
    assert.throws(() =>
      validateSensitiveBody(
        "/api/requests",
        "POST",
        Buffer.from(JSON.stringify(invalid)),
      ),
    );
});

test("Zod generation translates only annotated code-point limits without mutating the public contract", async () => {
  const { codePointTransformer } =
    await import("../../../lib/api-spec/code-point-transformer.ts");
  const contract = {
    openapi: "3.1.0",
    info: { title: "Api", version: "0" },
    paths: {},
    components: {
      schemas: {
        Characters: {
          type: "string",
          maxLength: 2000,
          "x-length-unit": "unicode-code-points",
        },
        Other: { type: "string", maxLength: 2000 },
      },
    },
  };
  const transformed = await codePointTransformer(contract);
  assert.equal(contract.components.schemas.Characters.maxLength, 2000);
  const schemas = transformed.components!.schemas! as Record<
    string,
    Record<string, unknown>
  >;
  assert.equal(schemas.Characters!.maxLength, undefined);
  assert.equal(
    schemas.Characters!.pattern,
    "^(?:\\p{Any}){0,2000}(?!\\p{Any})",
  );
  assert.equal(schemas.Other!.maxLength, 2000);
  for (const invalid of [
    {
      type: "string",
      maxLength: "2000",
      "x-length-unit": "unicode-code-points",
    },
    {
      type: "string",
      maxLength: 2000,
      pattern: "other",
      "x-length-unit": "unicode-code-points",
    },
  ])
    assert.throws(() =>
      codePointTransformer({
        ...contract,
        components: { schemas: { Invalid: invalid } },
      }),
    );
});

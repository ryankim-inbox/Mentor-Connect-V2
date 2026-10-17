import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const read = (p) => readFileSync(resolve(root, p), "utf8");
execFileSync("pnpm", ["--filter", "@workspace/api-gateway", "build"], {
  cwd: root,
  stdio: "pipe",
});
const { publicRoutes, requiredAuthority } =
  await import("../../../artifacts/api-gateway/dist/route-policy.js");
const spec = parse(read("lib/api-spec/openapi.yaml"));
const key = (method, path) =>
  `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, "{param}")}`;
const gateway = new Set(publicRoutes.map((r) => key(r.method, r.template)));
const openapi = new Set();
let operationCount = 0;
for (const [path, item] of Object.entries(spec.paths))
  for (const [method, op] of Object.entries(item)) {
    if (
      ![
        "get",
        "post",
        "patch",
        "delete",
        "put",
        "head",
        "options",
        "trace",
      ].includes(method)
    )
      continue;
    operationCount++;
    openapi.add(key(method, "/api" + path));
    const route = publicRoutes.find(
      (r) => key(r.method, r.template) === key(method, "/api" + path),
    );
    assert.ok(route, `Unregistered OpenAPI operation ${method} ${path}`);
    assert.equal(
      op["x-required-authority"],
      route.authentication === "none" ? "public" : requiredAuthority(route),
    );
    assert.deepEqual(
      op.security,
      route.authentication === "none" ? [] : [{ cookieAuth: [] }],
    );
  }
function inventoryDecorators(source, router) {
  return [
    ...source.matchAll(
      new RegExp(
        `^@${router}\\.(get|post|patch|delete|put|head|options|trace|websocket)\\(['"]([^'"\\n]+)['"](?:,\\s*[^\\n]*)?\\)`,
        "gm",
      ),
    ),
  ];
}
assert.equal(
  inventoryDecorators('@router.get("/literal" + dynamic)', "router").length,
  0,
  "Dynamic routes must fail closed",
);
for (const source of [
  "@router.get('/literal')",
  '@router.get("/literal", dependencies=[Depends(require_admin)])',
])
  assert.equal(inventoryDecorators(source, "router")[0]?.[2], "/literal");
const includePattern =
  /^app\.include_router\((\w+)\.(router|ws_router)(?:, prefix=['"]([^'"]*)['"])?(?:, dependencies=\[Depends\(\w+\)\])?\)/gm;
for (const source of [
  "app.include_router(auth.router, prefix='/api', dependencies=[Depends(require_user)])",
  'app.include_router(auth.router, prefix="/api")',
]) {
  const match = [...source.matchAll(includePattern)];
  assert.equal(match.length, 1);
  assert.equal(match[0][3], "/api");
}
assert.equal(
  [
    ..."app.include_router(auth.router, prefix=dynamic)".matchAll(
      includePattern,
    ),
  ].length,
  0,
);

// Literal-only inventory: never import/execute Python, and fail when syntax needs human inventory work.
const main = read("Python/main.py");
const imports = new Map();
for (const [, from, names] of main.matchAll(
  /^from (routers|api\.routers) import ([\w, ]+)$/gm,
))
  for (const name of names.split(",").map((n) => n.trim()))
    imports.set(name, `Python/${from.replaceAll(".", "/")}/${name}.py`);
const python = new Set();
const websockets = [];
const includes = [...main.matchAll(includePattern)];
assert.equal(
  includes.length,
  (main.match(/^app\.include_router\(/gm) || []).length,
  "Dynamic include: update static inventory explicitly",
);
for (const [, name, router, prefix = ""] of includes) {
  assert.ok(imports.has(name));
  const source = read(imports.get(name));
  assert.ok(
    !/APIRouter\([^)]*prefix\s*=/.test(source),
    "Router prefix needs explicit inventory update",
  );
  const decorators = inventoryDecorators(source, router);
  assert.equal(
    decorators.length,
    (source.match(new RegExp(`^@${router}\\.`, "gm")) || []).length,
    `Dynamic decorator in ${name}: update inventory explicitly`,
  );
  for (const [, method, path] of decorators)
    if (method === "websocket") websockets.push(prefix + path);
    else python.add(key(method, prefix + path));
}
const mainRoutes = [
  ...main.matchAll(/^@app\.(get|post|patch|delete)\(['"]([^'"]+)['"]\)/gm),
];
assert.equal(
  mainRoutes.length,
  (main.match(/^@app\.(?!exception_handler\()/gm) || []).length,
);
for (const [, method, path] of mainRoutes) python.add(key(method, path));
assert.equal(operationCount, 62);
assert.equal(publicRoutes.length, 62);
assert.equal(python.size, 62);
assert.equal(openapi.size, 62);
assert.equal(gateway.size, 62);
assert.deepEqual(openapi, python);
assert.deepEqual(gateway, python);
assert.equal(websockets.length, 2);
assert.deepEqual(spec.components.schemas.ProfileSummary.required, [
  "id",
  "name",
  "subjects",
  "createdAt",
]);
assert.equal(spec.components.schemas.ErrorResponse.additionalProperties, false);
console.log(
  "Python REST 62 = OpenAPI 62 = gateway REST 62; WS 2; gateway operations separately: /livez, /readyz. No Python executed.",
);

// Check shared error/header contracts and path/query declarations for all operations.
const dereference = (value) =>
  value.$ref
    ? value.$ref
        .slice(2)
        .split("/")
        .reduce((o, k) => o[k], spec)
    : value;
for (const [path, item] of Object.entries(spec.paths))
  for (const [method, op] of Object.entries(item)) {
    if (!op.operationId) continue;
    const route = publicRoutes.find(
      (r) => key(r.method, r.template) === key(method, "/api" + path),
    );
    assert.deepEqual(
      new Set(
        (op.parameters ?? [])
          .filter((p) => p.in === "query")
          .map((p) => p.name),
      ),
      new Set(route.queryKeys),
    );
    assert.deepEqual(
      new Set(
        (op.parameters ?? [])
          .filter((p) => p.in === "path" && p.required)
          .map((p) => p.name),
      ),
      new Set([...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1])),
    );
    for (const [status, responseRef] of Object.entries(op.responses)) {
      const response = dereference(responseRef);
      assert.ok(response, `Unresolved response ${op.operationId}/${status}`);
      assert.ok(
        response.headers?.["X-Request-Id"],
        `${op.operationId}/${status} correlation header`,
      );
      if (Number(status) >= 400)
        assert.equal(
          response.content["application/json"].schema.$ref,
          "#/components/schemas/ErrorResponse",
        );
    }
    for (const status of [429, 502, 503, 504]) assert.ok(op.responses[status]);
  }
assert.equal(
  spec.components.securitySchemes.cookieAuth.name,
  "peerbridge_session",
);
assert.deepEqual(
  Object.keys(spec.components.schemas.ErrorResponse.properties),
  ["error"],
);
assert.ok(spec.components.responses.Error429.headers["Retry-After"]);
console.log(
  "All 62 operations match security, query/path declarations, shared errors, and correlation headers.",
);

for (const [path, model] of [
  ["/chat/rooms/{roomId}/messages", "ChatMessage"],
  ["/dms/{conversationId}/messages", "DmMessage"],
]) {
  for (const status of ["200", "201"]) {
    const alternatives =
      spec.paths[path].post.responses[status].content["application/json"].schema
        .oneOf;
    assert.deepEqual(
      alternatives.map((item) => item.$ref),
      [`#/components/schemas/${model}`, "#/components/schemas/ScaffoldTodo"],
    );
  }
}

for (const name of [
  "RegisterBody",
  "LoginBody",
  "UpdateUserBody",
  "CreateRequestBody",
  "UpdateRequestBody",
  "CreateReportBody",
  "BlockUserBody",
  "SendChatMessageBody",
  "StartDmBody",
  "MatchRequest",
  "ApplicationAction",
  "CreateCommentBody",
  "ConfirmVerificationBody",
  "EditCommentBody",
  "ModerateReportBody",
])
  assert.equal(
    spec.components.schemas[name].additionalProperties,
    false,
    `${name} rejects unknown claims`,
  );
for (const field of ["isVerified", "isAdmin"])
  assert.ok(spec.components.schemas.User.required.includes(field));
for (const field of ["updatedAt", "deletedAt"])
  assert.ok(spec.components.schemas.RequestComment.required.includes(field));
assert.equal(
  spec.components.schemas.CreateReportBody.properties.description.maxLength,
  2000,
);
assert.equal(
  spec.components.schemas.SendChatMessageBody.properties.body.maxLength,
  2000,
);
assert.deepEqual(
  Object.keys(spec.components.schemas.MentorDirectoryEntry.properties),
  ["id", "name", "role", "subjects", "districtId", "districtName", "bio"],
);
console.log(
  "All trust/admin authorities, strict sensitive body schemas, directory privacy and comment tombstones are declared.",
);

// Character-bounded fields must keep Python/JSON Schema code-point semantics
// through generated validation. Readable report evidence predates write limits.
for (const [model, field] of [
  ["RequestComment", "body"],
  ["CreateCommentBody", "body"],
  ["EditCommentBody", "body"],
  ["CreateReportBody", "description"],
  ["ModerateReportBody", "note"],
  ["ModerationReport", "note"],
]) {
  const property = spec.components.schemas[model].properties[field];
  assert.equal(property.maxLength, 2000);
  assert.equal(property["x-length-unit"], "unicode-code-points");
}
assert.equal(
  spec.components.schemas.ModerationReport.properties.description.maxLength,
  undefined,
);
console.log(
  "Code-point character limits and unrestricted preserved report evidence are explicit.",
);

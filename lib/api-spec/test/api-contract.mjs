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
const { publicRoutes } =
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
    assert.deepEqual(
      op.security,
      route.authentication === "none" ? [] : [{ cookieAuth: [] }],
    );
  }
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
const includes = [
  ...main.matchAll(
    /^app\.include_router\((\w+)\.(router|ws_router)(?:, prefix="([^"]*)")?\)/gm,
  ),
];
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
  const decorators = [
    ...source.matchAll(
      new RegExp(
        `^@${router}\\.(get|post|patch|delete|put|head|options|trace|websocket)\\("([^"\\n]+)"[^\\n]*\\)`,
        "gm",
      ),
    ),
  ];
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
  ...main.matchAll(/^@app\.(get|post|patch|delete)\("([^"]+)"\)/gm),
];
assert.equal(mainRoutes.length, (main.match(/^@app\./gm) || []).length);
for (const [, method, path] of mainRoutes) python.add(key(method, path));
assert.equal(operationCount, 48);
assert.equal(publicRoutes.length, 48);
assert.equal(python.size, 48);
assert.equal(openapi.size, 48);
assert.equal(gateway.size, 48);
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
  "Python REST 48 = OpenAPI 48 = gateway REST 48; WS 2; gateway operations separately: /livez, /readyz. No Python executed.",
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
  "All 48 operations match security, query/path declarations, shared errors, and correlation headers.",
);

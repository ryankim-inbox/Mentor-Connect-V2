import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createGatewayServer } from "../src/gateway.ts";

test("serves the built SPA with safe fallback and security headers", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gateway-static-"));
  await mkdir(path.join(root, "assets"));
  await writeFile(
    path.join(root, "index.html"),
    "<!doctype html><title>SPA</title>",
  );
  await writeFile(
    path.join(root, "assets/App-aBc12345.js"),
    "export const app = true;",
  );
  await symlink("/etc/passwd", path.join(root, "assets/leak.js"));
  const server = createGatewayServer({
    staticDirectory: root,
    publicOrigin: "https://test.invalid",
    logger: { info() {} },
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    for (const route of [
      "/",
      "/login",
      "/dashboard",
      "/requests/42",
      "/connections",
      "/profile/1",
      "/dashboard/practice-lab",
    ]) {
      const response = await fetch(base + route, {
        headers: { accept: "text/html" },
      });
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get("content-type")!, /text\/html/);
      assert.equal(response.headers.get("cache-control"), "no-cache");
      assert.match(
        response.headers.get("content-security-policy")!,
        /frame-ancestors 'none'/,
      );
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.match(await response.text(), /SPA/);
    }
    const asset = await fetch(base + "/assets/App-aBc12345.js");
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type")!, /javascript/);
    assert.match(asset.headers.get("cache-control")!, /immutable/);
    assert.equal(
      (await fetch(base + "/assets/App-aBc12345.js", { method: "HEAD" }))
        .status,
      200,
    );
    for (const route of [
      "/api/missing",
      "/ws/missing",
      "/missing",
      "/assets/missing.js",
      "/assets/leak.js",
      "/.env",
      "/.git/config",
      "/assets/%2e%2e%2f.env",
    ]) {
      const response = await fetch(base + route, {
        headers: { accept: "text/html" },
      });
      assert.ok(response.status >= 400, route);
      assert.doesNotMatch(await response.text(), /<!doctype html>/i);
    }
    assert.equal(
      (await fetch(base + "/dashboard", { method: "POST" })).status,
      404,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

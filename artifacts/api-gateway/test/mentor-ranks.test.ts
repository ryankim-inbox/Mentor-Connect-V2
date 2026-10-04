import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test, { type TestContext } from "node:test";

import { createGatewayServer } from "../src/gateway.ts";

interface Harness {
  origin: string;
  upstreamPaths: string[];
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function createHarness(context: TestContext): Promise<Harness> {
  const upstreamPaths: string[] = [];
  const upstream = createServer((request, response) => {
    upstreamPaths.push(`${request.method} ${request.url}`);

    response.writeHead(200, { "content-type": "application/json" });
    response.end("{}");
  });
  context.after(async () => {
    if (upstream.listening) await close(upstream);
  });
  const upstreamOrigin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin,
    publicOrigin: "http://127.0.0.1:14200",
    allowLoopbackPublicOrigin: true,
    logger: { info() {} },
  });
  context.after(async () => {
    if (gateway.listening) await close(gateway);
  });
  const origin = await listen(gateway);

  return {
    origin,
    upstreamPaths,
  };
}

test("authenticated rank list and canonical mentor lookup remain outside the public API", async (context) => {
  const harness = await createHarness(context);

  for (const path of ["/api/mentor-ranks", "/api/mentor-ranks/523"]) {
    const response = await fetch(harness.origin + path, {
      headers: { cookie: "session=mentor" },
    });

    assert.equal(response.status, 404);
  }

  assert.deepEqual(harness.upstreamPaths, []);
});

test("anonymous rank reads are rejected before reaching upstream", async (context) => {
  const harness = await createHarness(context);

  for (const path of ["/api/mentor-ranks", "/api/mentor-ranks/523"]) {
    const response = await fetch(harness.origin + path);

    assert.equal(response.status, 404);
  }

  assert.deepEqual(harness.upstreamPaths, []);
});

test("invalid rank IDs, descendants, and query strings stay denied", async (context) => {
  const harness = await createHarness(context);

  for (const path of [
    "/api/mentor-ranks/0",
    "/api/mentor-ranks/01",
    "/api/mentor-ranks/-1",
    "/api/mentor-ranks/523/history",
    "/api/mentor-ranks?limit=5",
    "/api/mentor-ranks/523?detail=full",
  ]) {
    const response = await fetch(harness.origin + path, {
      headers: { cookie: "session=mentor" },
    });
    assert.equal(response.status, 404);
  }

  assert.deepEqual(harness.upstreamPaths, []);
});

test("write methods do not gain access to rank routes", async (context) => {
  const harness = await createHarness(context);

  for (const path of ["/api/mentor-ranks", "/api/mentor-ranks/523"]) {
    for (const method of ["POST", "PATCH", "DELETE"]) {
      const response = await fetch(harness.origin + path, {
        method,
        headers: {
          "content-type": "application/json",
          cookie: "session=mentor",
        },
        body: JSON.stringify({ rank: 1 }),
      });
      assert.equal(response.status, 404);
    }
  }

  assert.deepEqual(harness.upstreamPaths, []);
});

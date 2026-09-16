import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";

import { createGatewayServer } from "../src/gateway.ts";

interface Harness {
  origin: string;
  upstreamPaths: string[];
  close: () => Promise<void>;
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

async function createHarness(): Promise<Harness> {
  const upstreamPaths: string[] = [];
  const upstream = createServer((request, response) => {
    upstreamPaths.push(`${request.method} ${request.url}`);

    if (request.url === "/api/auth/me") {
      const authenticated = request.headers.cookie === "session=mentor";
      response.writeHead(authenticated ? 200 : 401, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(authenticated ? { id: 523 } : { detail: "Not authenticated" }));
      return;
    }

    if (request.url === "/api/mentor-ranks") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('[{"mentorId":523,"mentorName":"Ada","matchedCount":12,"rank":1,"badge":"Master"}]');
      return;
    }

    if (request.url === "/api/mentor-ranks/523") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"mentorId":523,"mentorName":"Ada","matchedCount":12,"rank":1,"badge":"Master"}');
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"detail":"Not found"}');
  });
  const upstreamOrigin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin,
    logger: { info() {} },
  });
  const origin = await listen(gateway);

  return {
    origin,
    upstreamPaths,
    close: async () => {
      await Promise.all([close(gateway), close(upstream)]);
    },
  };
}

test("authenticated rank list and canonical mentor lookup are forwarded", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  for (const path of ["/api/mentor-ranks", "/api/mentor-ranks/523"]) {
    const response = await fetch(harness.origin + path, {
      headers: { cookie: "session=mentor" },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("vary"), "Cookie");
  }

  assert.deepEqual(harness.upstreamPaths, [
    "GET /api/auth/me",
    "GET /api/mentor-ranks",
    "GET /api/auth/me",
    "GET /api/mentor-ranks/523",
  ]);
});

test("anonymous rank reads are rejected before reaching upstream", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  for (const path of ["/api/mentor-ranks", "/api/mentor-ranks/523"]) {
    const response = await fetch(harness.origin + path);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }

  assert.deepEqual(harness.upstreamPaths, []);
});

test("invalid rank IDs, descendants, and query strings stay denied", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

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
  const harness = await createHarness();
  context.after(harness.close);

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

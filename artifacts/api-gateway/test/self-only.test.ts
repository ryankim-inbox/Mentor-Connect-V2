import assert from "node:assert/strict";
import { once } from "node:events";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createGatewayServer } from "../src/gateway.ts";

const authenticatedUser = {
  id: 1,
  email: "student@example.edu",
  name: "Student One",
  role: "mentee",
  districtId: 7,
  districtName: "Example District",
  bio: "Private free-form bio",
  subjects: ["Math", "Science"],
  isVerified: true,
  createdAt: "2026-08-26T00:00:00+00:00",
};

const upstreamUser = {
  ...authenticatedUser,
  email: "student@example.edu",
};

const otherUpstreamUser = {
  ...upstreamUser,
  id: 2,
  email: "other-private@example.edu",
  name: "Student Two",
  bio: "Other private bio",
  subjects: ["Art"],
  createdAt: "2026-08-27T00:00:00+00:00",
};

interface CallCounts {
  authMe: number;
  user: number;
  patchedBodies: unknown[];
}

interface Harness {
  origin: string;
  calls: CallCounts;
  close: () => Promise<void>;
}

async function createHarness(): Promise<Harness> {
  const calls: CallCounts = { authMe: 0, user: 0, patchedBodies: [] };
  const upstream = createServer(async (request, response) => {
    if (request.url === "/api/auth/me") {
      calls.authMe += 1;
      if (request.headers.cookie !== "session=user-a") {
        sendJson(response, 401, { detail: "Not authenticated" });
        return;
      }

      sendJson(response, 200, authenticatedUser);
      return;
    }

    if (request.url === "/api/users/1" || request.url === "/api/users/2") {
      calls.user += 1;
      if (request.method === "PATCH") {
        calls.patchedBodies.push(await readJson(request));
      }
      sendJson(
        response,
        200,
        request.url.endsWith("/2") ? otherUpstreamUser : upstreamUser,
      );
      return;
    }

    sendJson(response, 404, { detail: "Not found" });
  });

  const upstreamOrigin = await listen(upstream);
  const gateway = createGatewayServer({
    upstreamOrigin,
    logger: { info() {} },
  });
  const origin = await listen(gateway);

  return {
    origin,
    calls,
    close: async () => {
      await Promise.all([close(gateway), close(upstream)]);
    },
  };
}

test("anonymous profile lookup is rejected without any upstream call", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const response = await fetch(harness.origin + "/api/users/1");

  assert.equal(response.status, 401);
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(harness.calls.authMe, 0);
  assert.equal(harness.calls.user, 0);
});

test("an invalid session is rejected before the profile endpoint is called", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const response = await fetch(harness.origin + "/api/users/1", {
    headers: { cookie: "session=invalid" },
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "unauthorized" });
  assert.equal(harness.calls.authMe, 1);
  assert.equal(harness.calls.user, 0);
});

test("a session sees another user's four-field public profile", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const response = await fetch(harness.origin + "/api/users/2", {
    headers: { cookie: "session=user-a" },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: 2,
    name: "Student Two",
    subjects: ["Art"],
    createdAt: "2026-08-27T00:00:00+00:00",
  });
  assert.equal(harness.calls.authMe, 1);
  assert.equal(harness.calls.user, 1);
});

test("a session cannot patch another user's profile", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const response = await fetch(harness.origin + "/api/users/2", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: "session=user-a",
    },
    body: JSON.stringify({ name: "Changed" }),
  });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: "not_found" });
  assert.equal(harness.calls.authMe, 1);
  assert.equal(harness.calls.user, 0);
  assert.deepEqual(harness.calls.patchedBodies, []);
});

test("a self profile response is an explicit minimum schema", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const response = await fetch(harness.origin + "/api/users/1", {
    headers: { cookie: "session=user-a" },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Cookie");
  assert.deepEqual(body, {
    id: 1,
    name: "Student One",
    subjects: ["Math", "Science"],
    createdAt: "2026-08-26T00:00:00+00:00",
  });
  assert.equal(harness.calls.authMe, 1);
  assert.equal(harness.calls.user, 1);
});

test("all non-allowlisted PATCH fields are rejected before authentication or profile forwarding", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  for (const payload of [
    { role: "mentor" },
    { is_verified: true },
    { id: 2 },
    { email: "other@example.edu" },
    { unexpected: "field" },
  ]) {
    const response = await fetch(harness.origin + "/api/users/1", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie: "session=user-a",
      },
      body: JSON.stringify(payload),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "invalid_profile_update",
    });
  }

  assert.equal(harness.calls.authMe, 0);
  assert.equal(harness.calls.user, 0);
});

test("allowlisted PATCH fields are sanitized and forwarded only for the session owner", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  const response = await fetch(harness.origin + "/api/users/1", {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie: "session=user-a",
    },
    body: JSON.stringify({
      name: " Updated student ",
      bio: "Updated private bio",
      subjects: ["Math", "Art"],
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    id: 1,
    name: "Student One",
    subjects: ["Math", "Science"],
    createdAt: "2026-08-26T00:00:00+00:00",
  });
  assert.equal(harness.calls.authMe, 1);
  assert.equal(harness.calls.user, 1);
  assert.deepEqual(harness.calls.patchedBodies, [
    {
      name: "Updated student",
      bio: "Updated private bio",
      subjects: ["Math", "Art"],
    },
  ]);
});

test("encoded, doubled, and query-string user paths do not bypass the allowlist", async (context) => {
  const harness = await createHarness();
  context.after(harness.close);

  for (const pathname of [
    "/api/users/%31",
    "/api/users//1",
    "/api/users/1?probe=1",
    "/api/users/01",
    "/api/users/0",
  ]) {
    const response = await fetch(harness.origin + pathname, {
      headers: { cookie: "session=user-a" },
    });
    assert.ok(response.status === 400 || response.status === 404, pathname);
  }

  assert.equal(harness.calls.authMe, 0);
  assert.equal(harness.calls.user, 0);
});

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function listen(server: Server): Promise<string> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return "http://127.0.0.1:" + String(address.port);
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import test, { type TestContext } from "node:test";
import { createGatewayServer, type GatewayOptions } from "../src/gateway.ts";
import { createWebSocketUpgradeHandler } from "../src/websocket.ts";

const KEY = "dGhlIHNhbXBsZSBub25jZQ==";
const ACCEPT = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
const OK = `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${ACCEPT}\r\n`;
const ORIGIN = "https://mentor.example";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as { port: number }).port;
}

async function fixture(
  t: TestContext,
  upgrade: (request: IncomingMessage, socket: Duplex, head: Buffer) => void = (
    _request,
    socket,
  ) => {
    socket.write(OK + "\r\n");
    socket.pipe(socket);
  },
  overrides: Partial<Parameters<typeof createWebSocketUpgradeHandler>[0]> = {},
  gatewayOptions?: GatewayOptions,
) {
  const sockets = new Set<Duplex>();
  const calls: IncomingMessage[] = [];
  const logs: Record<string, string | number | boolean>[] = [];
  const authCalls: IncomingMessage[] = [];
  const upstream = createServer((request, response) => {
    authCalls.push(request);
    if (request.url !== "/api/auth/me") {
      response.writeHead(404).end();
      return;
    }
    const id = Number(request.headers.cookie?.replace("session=", ""));
    if (!Number.isSafeInteger(id) || id <= 0) {
      response.writeHead(401).end();
      return;
    }
    response.writeHead(200, {
      "content-type": "application/json",
      "set-cookie": ["renewed=1; HttpOnly", "csrf=2"],
    });
    response.end(JSON.stringify({ id }));
  });
  upstream.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  upstream.on("upgrade", (request, socket, head) => {
    calls.push(request);
    upgrade(request, socket, head);
  });
  const upstreamPort = await listen(upstream);
  const handler = createWebSocketUpgradeHandler({
    upstreamOrigin: new URL(`http://127.0.0.1:${upstreamPort}`),
    verifySession: async (request) => {
      if (!request.headers.cookie?.startsWith("session="))
        throw new Error("unauthorized");
      return {
        userId: Number(request.headers.cookie.slice(8)),
        setCookies: ["renewed=1; HttpOnly"],
      };
    },
    assertOrigin: (request) => assert.equal(request.headers.origin, ORIGIN),
    logger: { info: (_event, fields) => logs.push({ ...fields }) },
    ...overrides,
  });
  const gateway =
    gatewayOptions === undefined
      ? createServer()
      : createGatewayServer({
          upstreamOrigin: `http://127.0.0.1:${upstreamPort}`,
          publicOrigin: ORIGIN,
          logger: { info: (_event, fields) => logs.push({ ...fields }) },
          ...gatewayOptions,
        });
  if (gatewayOptions === undefined) gateway.on("upgrade", handler);
  const port = await listen(gateway);
  t.after(async () => {
    handler.closeWebSockets();
    if ("closeWebSockets" in gateway) (gateway.closeWebSockets as () => void)();
    for (const socket of sockets) socket.destroy();
    await Promise.all([
      new Promise<void>((r) => gateway.close(() => r())),
      new Promise<void>((r) => upstream.close(() => r())),
    ]);
  });
  return { port, handler, calls, logs, sockets, gateway, authCalls };
}

async function client(
  port: number,
  path = "/ws/chat/rooms/1",
  changes: Record<string, string | undefined> = {},
  head = "",
) {
  const socket = connect(port, "127.0.0.1");
  socket.on("error", () => {});
  await once(socket, "connect");
  let received = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
  });
  const headers: Record<string, string | undefined> = {
    Host: `127.0.0.1:${port}`,
    Upgrade: "websocket",
    Connection: "Upgrade",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": KEY,
    Origin: ORIGIN,
    Cookie: "session=1",
    ...changes,
  };
  socket.write(
    `GET ${path} HTTP/1.1\r\n` +
      Object.entries(headers)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join("") +
      "\r\n" +
      head,
  );
  async function until(predicate: (data: Buffer) => boolean, timeout = 2_000) {
    const started = Date.now();
    while (!predicate(received)) {
      if (Date.now() - started > timeout)
        throw new Error(`Timed out: ${received.toString()}`);
      await new Promise((r) => setTimeout(r, 5));
    }
    return received.toString();
  }
  return {
    socket,
    until,
    data: () => received.toString(),
    handshake: () => until((b) => b.includes("\r\n\r\n")),
  };
}

for (const path of ["/ws/chat/rooms/1", "/ws/dms/42"]) {
  test(`tunnels authenticated ${path}, filters headers and replaces request IDs`, async (t) => {
    const f = await fixture(t, (_request, socket) => {
      socket.write(
        OK +
          "Set-Cookie: first=1\r\nSet-Cookie: second=2\r\nX-Internal: secret\r\n\r\n",
      );
      socket.pipe(socket);
    });
    const c = await client(f.port, path, {
      "X-Request-Id": "untrusted",
      Authorization: "Bearer secret",
      "X-Forwarded-For": "1.2.3.4",
    });
    const response = await c.handshake();
    assert.match(response, /^HTTP\/1.1 101 /);
    assert.match(
      response,
      /Set-Cookie: renewed=1; HttpOnly\r\nSet-Cookie: first=1\r\nSet-Cookie: second=2/i,
    );
    assert.doesNotMatch(response, /secret|untrusted/);
    assert.equal(f.calls[0]?.url, path);
    assert.equal(f.calls[0]?.headers.cookie, "session=1");
    assert.match(
      f.calls[0]?.headers["x-request-id"] as string,
      /^[a-f\d-]{36}$/,
    );
    assert.match(
      response,
      new RegExp(f.calls[0]?.headers["x-request-id"] as string),
    );
    assert.equal(f.calls[0]?.headers.authorization, undefined);
    assert.equal(f.calls[0]?.headers["x-forwarded-for"], undefined);
    assert.equal(f.calls[0]?.headers.origin, undefined);
    c.socket.write("opaque bytes");
    await c.until((b) => b.includes("opaque bytes"));
    c.socket.destroy();
  });
}

test("rejects anonymous, hostile/missing origins and noncanonical paths before upstream", async (t) => {
  const f = await fixture(t);
  for (const path of [
    "/ws/chat/1",
    "/ws/chat/rooms/0",
    "/ws/chat/rooms/01",
    "/ws/dms/-1",
    "/ws/dms/9007199254740992",
    "/ws/dms/1/",
    "/ws/dms/1?",
    "/ws/dms/%31",
    "/ws/dms/1#fragment",
  ]) {
    const c = await client(f.port, path);
    assert.match(await c.handshake(), /^HTTP\/1.1 403 /);
  }
  for (const headers of [
    { Cookie: undefined },
    { Origin: undefined },
    { Origin: "null" },
    { Origin: "https://evil.example" },
  ]) {
    const c = await client(f.port, undefined, headers);
    assert.match(await c.handshake(), /^HTTP\/1.1 403 /);
  }
  assert.equal(f.calls.length, 0);
});

test("copies client and upstream head buffers exactly once, before subsequent bytes", async (t) => {
  let upstreamBytes = "";
  const f = await fixture(t, (_request, socket, head) => {
    upstreamBytes += head.toString();
    socket.on("data", (b) => {
      upstreamBytes += b.toString();
    });
    socket.write(OK + "\r\nupstream-head");
  });
  const c = await client(f.port, undefined, {}, "client-head");
  await c.until((b) => b.includes("upstream-head"));
  c.socket.write("-next");
  await c.until(() => upstreamBytes.includes("-next"));
  assert.equal(upstreamBytes, "client-head-next");
  assert.equal(c.data().split("\r\n\r\n")[1], "upstream-head");
});

test("rejects malformed and duplicate client handshake headers", async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { "Sec-WebSocket-Key": "bad" },
    { "Sec-WebSocket-Key": undefined },
    { "Sec-WebSocket-Version": "12" },
    { "Sec-WebSocket-Key": KEY + "\r\nSec-WebSocket-Key: " + KEY },
    { "Content-Length": "1" },
    { "Transfer-Encoding": "chunked" },
    { Origin: ORIGIN + "\r\nOrigin: " + ORIGIN },
    { "Sec-WebSocket-Protocol": "chat,,other" },
  ]) {
    const c = await client(f.port, undefined, headers);
    assert.match(await c.handshake(), /^HTTP\/1.1 400 /);
  }
  assert.equal(f.calls.length, 0);
});

test("accepts requested protocol/extensions while rejecting invalid upstream handshakes", async (t) => {
  const good = await fixture(t, (_request, socket) =>
    socket.write(
      OK +
        "Sec-WebSocket-Protocol: chat\r\nSec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover\r\n\r\n",
    ),
  );
  const c = await client(good.port, undefined, {
    "Sec-WebSocket-Protocol": "chat, other",
    "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits",
  });
  assert.match(await c.handshake(), /^HTTP\/1.1 101 /);
  for (const response of [
    OK.replace(ACCEPT, "wrong") + "\r\n",
    OK.replace(`Sec-WebSocket-Accept: ${ACCEPT}\r\n`, "") + "\r\n",
    OK.replace("Upgrade: websocket", "Upgrade: other") + "\r\n",
    OK.replace("Connection: Upgrade\r\n", "") + "\r\n",
    OK + "Sec-WebSocket-Protocol: unexpected\r\n\r\n",
    OK + "Sec-WebSocket-Extensions: surprise\r\n\r\n",
    OK + `Sec-WebSocket-Accept: ${ACCEPT}\r\n\r\n`,
    OK + "Content-Length: 12\r\n\r\n",
    OK + "Set-Cookie: bad\u0001cookie\r\n\r\n",
  ]) {
    const bad = await fixture(t, (_request, socket) => socket.write(response));
    const peer = await client(bad.port);
    assert.match(await peer.handshake(), /^HTTP\/1.1 502 /);
  }
});

test("bounds and sanitizes non-101 bodies and rejects truncated HTTP responses", async (t) => {
  for (const [response, status] of [
    ["HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\nsecret", 403],
    ["HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n", 404],
    ["HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n", 502],
    [
      "HTTP/1.1 403 Forbidden\r\nContent-Length: 20000\r\n\r\n" +
        "x".repeat(20000),
      502,
    ],
    ["HTTP/1.1 403 Forbidden\r\nContent-Length: 30\r\n\r\nshort", 502],
    ["HTTP/1.1 101 Switching Protocols\r\nUpgrade: web", 502],
  ] as const) {
    const f = await fixture(t, (_request, socket) => socket.end(response));
    const c = await client(f.port);
    assert.match(await c.handshake(), new RegExp(`^HTTP/1.1 ${status} `));
    assert.doesNotMatch(c.data(), /secret/);
    assert.ok(c.data().length < 1_000);
    assert.equal(
      f.logs.some((l) => l.outcome === "upgraded"),
      false,
    );
  }
});

test("rejects CR/LF from the session cookie callback without opening a tunnel", async (t) => {
  const f = await fixture(t, undefined, {
    verifySession: async () => ({
      userId: 1,
      setCookies: ["bad=1\r\nInjected: value"],
    }),
  });
  const c = await client(f.port);
  assert.match(await c.handshake(), /^HTTP\/1.1 502 /);
  assert.equal(f.calls.length, 0);
});

test("reserves two slots per user, releases disconnected sockets and isolates gateway cleanup", async (t) => {
  const f = await fixture(t);
  const a = await client(f.port);
  await a.handshake();
  const b = await client(f.port);
  await b.handshake();
  const denied = await client(f.port);
  assert.match(await denied.handshake(), /^HTTP\/1.1 429 /);
  a.socket.destroy();
  await a.until(() => f.sockets.size === 1);
  const replacement = await client(f.port);
  assert.match(await replacement.handshake(), /^HTTP\/1.1 101 /);
  const other = await fixture(t);
  const independent = await client(other.port);
  await independent.handshake();
  f.handler.closeWebSockets();
  await replacement.until(
    () => replacement.socket.destroyed && b.socket.destroyed,
  );
  independent.socket.write("still-open");
  await independent.until((bytes) => bytes.includes("still-open"));
  const draining = await client(f.port);
  assert.match(await draining.handshake(), /^HTTP\/1.1 503 /);
});

test("caps the gateway at 40 simultaneous handshakes before authentication resolves", async (t) => {
  const resolvers: (() => void)[] = [];
  const f = await fixture(t, undefined, {
    verifySession: async (request) => {
      await new Promise<void>((resolve) => resolvers.push(resolve));
      return {
        userId: Number(request.headers.cookie?.slice(8)),
        setCookies: [],
      };
    },
  });
  const peers = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      client(f.port, undefined, { Cookie: `session=${i + 1}` }),
    ),
  );
  await peers[0]!.until(() => resolvers.length === 40);
  const denied = await client(f.port, undefined, { Cookie: "session=41" });
  assert.match(await denied.handshake(), /^HTTP\/1.1 429 /);
  for (const resolve of resolvers) resolve();
  for (const peer of peers)
    assert.match(await peer.handshake(), /^HTTP\/1.1 101 /);
  assert.equal(f.calls.length, 40);
});

test("disconnect and shutdown abort pending authentication and ignore late session results", async (t) => {
  for (const shutdown of [false, true]) {
    let signal: AbortSignal | undefined;
    let finish!: () => void;
    const f = await fixture(t, undefined, {
      verifySession: async (_request, receivedSignal) => {
        signal = receivedSignal;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { userId: 1, setCookies: [] };
      },
    });
    const c = await client(f.port);
    await c.until(() => signal !== undefined);
    if (shutdown) f.handler.closeWebSockets();
    else c.socket.destroy();
    await c.until(() => signal!.aborted);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(f.calls.length, 0);
  }
});

test("maintenance rejects before authentication, and upstream disconnect closes its client", async (t) => {
  let authenticated = false;
  const maintenance = await fixture(t, undefined, {
    maintenanceMode: true,
    verifySession: async () => {
      authenticated = true;
      return { userId: 1, setCookies: [] };
    },
  });
  const denied = await client(maintenance.port);
  assert.match(await denied.handshake(), /^HTTP\/1.1 503 /);
  assert.equal(authenticated, false);
  const f = await fixture(t);
  const c = await client(f.port);
  await c.handshake();
  for (const socket of f.sockets) socket.destroy();
  await c.until(() => c.socket.destroyed);
});

test(
  "five-second deadline aborts stalled authentication, handshake and body",
  { timeout: 8_000 },
  async (t) => {
    let authSignal: AbortSignal | undefined;
    const auth = await fixture(t, undefined, {
      verifySession: async (_request, signal) => {
        authSignal = signal;
        return new Promise(() => {});
      },
    });
    const upgrade = await fixture(t, () => {});
    const body = await fixture(t, (_request, socket) =>
      socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 2\r\n\r\nx"),
    );
    const peers = await Promise.all(
      [auth, upgrade, body].map((f) => client(f.port)),
    );
    const start = Date.now();
    for (const peer of peers) {
      const response = await peer.until((b) => b.includes("\r\n\r\n"), 6_000);
      assert.match(response, /^HTTP\/1.1 504 /);
    }
    assert.ok(Date.now() - start >= 4_800);
    assert.ok(authSignal?.aborted);
  },
);

test("drains upstream's final bytes before closing a slow client", async (t) => {
  const payload = Buffer.alloc(8 * 1024 * 1024 + 17, 97);
  const f = await fixture(t, (_request, socket) => {
    socket.write(OK + "\r\n");
    socket.end(payload);
  });
  const c = await client(f.port);
  c.socket.pause();
  await new Promise((resolve) => setTimeout(resolve, 50));
  c.socket.resume();
  await c.until(() => c.socket.destroyed, 3_000);
  assert.equal(c.data().split("\r\n\r\n")[1]?.length, payload.length);
});

test("native pipe pauses a fast upstream while the client is paused, then delivers every byte", async (t) => {
  const chunk = Buffer.alloc(64 * 1024, 120);
  let sent = 0;
  const total = 512;
  const f = await fixture(t, (_request, socket) => {
    socket.write(OK + "\r\n");
    function pump() {
      while (sent < total) {
        sent++;
        if (!socket.write(chunk)) {
          socket.once("drain", pump);
          return;
        }
      }
    }
    pump();
  });
  const c = await client(f.port);
  c.socket.pause();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.ok(sent < total, "backpressure must stop the upstream producer");
  c.socket.resume();
  await c.until(
    (bytes) => bytes.length >= total * chunk.length + OK.length + 2,
    8_000,
  );
  assert.equal(c.data().split("\r\n\r\n")[1], "x".repeat(total * chunk.length));
});

test("idle timeout closes a tunnel only after 120 seconds without activity", async (t) => {
  // Speed up only the idle deadline; all data and close behavior still uses native TCP.
  const nativeTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", ((
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ) =>
    nativeTimeout(
      callback,
      delay === 120_000 ? 100 : delay,
      ...args,
    )) as typeof setTimeout);
  const f = await fixture(t);
  const c = await client(f.port);
  await c.handshake();
  for (let i = 0; i < 4; i++) {
    await new Promise((resolve) => nativeTimeout(resolve, 40));
    c.socket.write(`activity-${i}`);
    await c.until((b) => b.includes(`activity-${i}`));
    assert.equal(c.socket.destroyed, false);
  }
  await c.until(() => c.socket.destroyed, 400);
});

test("client data during authentication cannot hide its disconnect or escape the tunnel", async (t) => {
  let signal: AbortSignal | undefined;
  let finish!: () => void;
  const f = await fixture(t, undefined, {
    verifySession: async (_request, receivedSignal) => {
      signal = receivedSignal;
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { userId: 1, setCookies: [] };
    },
  });
  const c = await client(f.port);
  await c.until(() => signal !== undefined);
  c.socket.write("early-data");
  c.socket.end();
  await c.until(() => signal!.aborted, 300);
  finish();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(f.calls.length, 0);
});

test("preserves bounded early bytes across delayed authentication and rejects overflow", async (t) => {
  const finishes: (() => void)[] = [];
  const f = await fixture(t, undefined, {
    verifySession: async () => {
      await new Promise<void>((resolve) => finishes.push(resolve));
      return { userId: 1, setCookies: [] };
    },
  });
  const c = await client(f.port, undefined, {}, "head-");
  await c.until(() => finishes.length === 1);
  c.socket.write("before-auth");
  await new Promise((resolve) => setTimeout(resolve, 10));
  finishes[0]!();
  await c.until((b) => b.includes("head-before-auth"));
  assert.equal(c.data().split("\r\n\r\n")[1], "head-before-auth");
  const overflow = await client(f.port);
  await overflow.until(() => finishes.length === 2);
  overflow.socket.write(Buffer.alloc(65_537));
  assert.match(await overflow.handshake(), /^HTTP\/1.1 413 /);
  finishes[1]!();
});

for (const path of ["/ws/chat/rooms/1", "/ws/dms/42"]) {
  test(`real gateway authenticates ${path} against Python's session endpoint and preserves cookies/heads`, async (t) => {
    const f = await fixture(
      t,
      (_request, socket, head) => {
        assert.equal(head.length, 0);
        socket.write(OK + "Set-Cookie: upgraded=1\r\n\r\nserver-head-");
        socket.pipe(socket);
      },
      {},
      {},
    );
    const c = await client(
      f.port,
      path,
      { "X-Request-Id": "untrusted" },
      "client-head",
    );
    await c.until((b) => b.includes("server-head-client-head"));
    assert.match(c.data(), /^HTTP\/1.1 101 /);
    assert.match(
      c.data(),
      /Set-Cookie: renewed=1; HttpOnly\r\nSet-Cookie: csrf=2\r\nSet-Cookie: upgraded=1/i,
    );
    assert.equal(f.authCalls.length, 1);
    assert.equal(f.authCalls[0]?.url, "/api/auth/me");
    assert.equal(f.authCalls[0]?.headers.cookie, "session=1");
    assert.equal(
      f.authCalls[0]?.headers["x-request-id"],
      f.calls[0]?.headers["x-request-id"],
    );
    assert.notEqual(f.calls[0]?.headers["x-request-id"], "untrusted");
    const closeWebSockets = (
      f.gateway as ReturnType<typeof createGatewayServer> & {
        closeWebSockets(): void;
      }
    ).closeWebSockets;
    assert.equal(typeof closeWebSockets, "function");
    closeWebSockets();
    await c.until(() => c.socket.destroyed && f.calls[0]!.socket.destroyed);
  });
}

test("real gateway refuses hostile origins, malformed headers and missing cookies before session fetch", async (t) => {
  const f = await fixture(t, undefined, {}, {});
  for (const [headers, status] of [
    [{ Origin: undefined }, 403],
    [{ Origin: "null" }, 403],
    [
      {
        Origin: "https://evil.example",
        Host: "evil.example",
        "X-Forwarded-Host": "mentor.example",
      },
      403,
    ],
    [{ Cookie: undefined }, 403],
    [{ "Sec-WebSocket-Key": "bad" }, 400],
  ] as const) {
    const c = await client(f.port, undefined, headers);
    assert.match(await c.handshake(), new RegExp(`^HTTP/1.1 ${status} `));
  }
  const unknown = await client(f.port, "/ws/chat/rooms/1?foo=secret");
  assert.match(await unknown.handshake(), /^HTTP\/1.1 403 /);
  assert.equal(f.authCalls.length, 0);
  assert.equal(f.calls.length, 0);
  assert.doesNotMatch(
    JSON.stringify(f.logs),
    /secret|session=|evil\.example|\/ws\//,
  );
});

test("real gateway rejects an invalid Python session and preserves upstream non-101 denial", async (t) => {
  const f = await fixture(
    t,
    (_request, socket) =>
      socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 6\r\n\r\nsecret"),
    {},
    {},
  );
  const invalid = await client(f.port, undefined, {
    Cookie: "session=invalid",
  });
  assert.match(await invalid.handshake(), /^HTTP\/1.1 403 /);
  assert.equal(f.authCalls.length, 1);
  assert.equal(f.calls.length, 0);
  const authenticated = await client(f.port);
  assert.match(await authenticated.handshake(), /^HTTP\/1.1 403 /);
  assert.equal(f.authCalls.length, 2);
  assert.equal(f.calls.length, 1);
  assert.doesNotMatch(authenticated.data(), /secret/);
});

test("real gateway maintenance and per-session tunnel limits remain active", async (t) => {
  const maintenance = await fixture(
    t,
    undefined,
    {},
    { maintenanceMode: true },
  );
  const denied = await client(maintenance.port);
  assert.match(await denied.handshake(), /^HTTP\/1.1 503 /);
  assert.equal(maintenance.authCalls.length, 0);
  const f = await fixture(t, undefined, {}, {});
  const peers = await Promise.all([client(f.port), client(f.port)]);
  for (const peer of peers)
    assert.match(await peer.handshake(), /^HTTP\/1.1 101 /);
  const third = await client(f.port);
  assert.match(await third.handshake(), /^HTTP\/1.1 429 /);
  assert.equal(f.calls.length, 2);
});

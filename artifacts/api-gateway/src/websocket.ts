import { createHash, randomUUID } from "node:crypto";
import {
  request as httpRequest,
  STATUS_CODES,
  validateHeaderValue,
  type ClientRequest,
  type IncomingMessage,
} from "node:http";
import type { Duplex } from "node:stream";

interface WebSocketOptions {
  upstreamOrigin: URL;
  verifySession(
    request: IncomingMessage,
    signal: AbortSignal,
    requestId: string,
  ): Promise<{ userId: number; setCookies: readonly string[] }>;
  assertOrigin(request: IncomingMessage): void;
  logger: {
    info(
      event: string,
      fields: Readonly<Record<string, string | number | boolean>>,
    ): void;
  };
  maintenanceMode?: boolean;
}

const TOKEN = /^[!#$%&'*+.^_`|~\da-z-]+$/i;
const FORWARD = [
  "cookie",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-protocol",
  "sec-websocket-extensions",
] as const;
const BODY_LIMIT = 16_384;

export function createWebSocketUpgradeHandler(options: WebSocketOptions) {
  // ponytail: these caps apply to one gateway process; share counters if deployment gains multiple instances.
  const connections = new Set<() => void>();
  const users = new Map<number, number>();
  let draining = false;

  const handler = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const requestId = randomUUID();
    const started = Date.now();
    const controller = new AbortController();
    let upstreamRequest: ClientRequest | undefined;
    let upstreamResponse: IncomingMessage | undefined;
    let upstreamSocket: Duplex | undefined;
    let userId: number | undefined;
    let ended = false;
    let upgraded = false;
    let earlyBytes = head.length;
    const earlyChunks = [head];
    let upstreamStarted: number | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const handshakeTimer = setTimeout(() => reject(504), 5_000);
    handshakeTimer.unref();
    socket.pause();
    socket.on("error", close);
    socket.on("end", close);
    socket.on("close", close);

    function log(outcome: string, status: number) {
      options.logger.info("gateway_websocket", {
        family: "websocket",
        outcome,
        status,
        requestId,
        durationMs: Date.now() - started,
        ...(upstreamStarted === undefined
          ? {}
          : { upstreamDurationMs: Date.now() - upstreamStarted }),
      });
    }

    function cleanup() {
      if (ended) return;
      ended = true;
      clearTimeout(handshakeTimer);
      clearTimeout(idleTimer);
      socket.off("data", collectEarlyBytes);
      earlyChunks.length = 0;
      connections.delete(close);
      if (userId !== undefined) {
        const remaining = (users.get(userId) ?? 1) - 1;
        if (remaining) users.set(userId, remaining);
        else users.delete(userId);
      }
      controller.abort();
      upstreamRequest?.destroy();
      upstreamResponse?.destroy();
      upstreamSocket?.destroy();
    }

    function close() {
      if (!ended) log(upgraded ? "closed" : "cancelled", upgraded ? 101 : 499);
      cleanup();
      socket.destroy();
    }

    function reject(status: number, error = "websocket_unavailable") {
      if (ended) return;
      log("rejected", status);
      cleanup();
      const body = JSON.stringify({
        error,
        requestId,
      });
      socket.end(
        `HTTP/1.1 ${status} ${STATUS_CODES[status]}\r\nConnection: close\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: ${Buffer.byteLength(body)}\r\nX-Request-Id: ${requestId}\r\n\r\n${body}`,
        () => socket.destroy(),
      );
    }

    if (draining || options.maintenanceMode) return reject(503);
    if (connections.size >= 40) return reject(429);
    connections.add(close);
    const match = /^\/ws\/(?:chat\/rooms|dms)\/([1-9]\d*)$/.exec(
      request.url ?? "",
    );
    if (!match || !Number.isSafeInteger(Number(match[1]))) return reject(403);
    try {
      validateClientHandshake(request);
    } catch {
      return reject(400);
    }
    try {
      if (!request.headers.origin) return reject(403, "forbidden");
      options.assertOrigin(request);
    } catch {
      return reject(403, "forbidden");
    }
    if (!request.headers.cookie?.trim()) return reject(403);

    // Read a bounded pre-upgrade buffer so a peer FIN is observed even during authentication.
    // Pausing here would hide disconnects behind unread data until the handshake deadline.
    if (earlyBytes > 65_536) return reject(413);
    socket.on("data", collectEarlyBytes);
    socket.resume();
    void authenticate();
    function collectEarlyBytes(chunk: Buffer) {
      earlyBytes += chunk.length;
      if (earlyBytes > 65_536) reject(413);
      else earlyChunks.push(chunk);
    }
    async function authenticate() {
      let session: Awaited<ReturnType<WebSocketOptions["verifySession"]>>;
      try {
        session = await options.verifySession(
          request,
          controller.signal,
          requestId,
        );
      } catch (error) {
        const unauthorized =
          error instanceof Error &&
          (error.message === "unauthorized" ||
            ("status" in error && [401, 403].includes(Number(error.status))));
        reject(unauthorized ? 403 : 502);
        return;
      }
      if (ended) return;
      if (!Number.isSafeInteger(session.userId) || session.userId <= 0)
        return reject(502);
      try {
        for (const cookie of session.setCookies)
          validateHeaderValue("set-cookie", cookie);
      } catch {
        return reject(502);
      }
      if ((users.get(session.userId) ?? 0) >= 2) return reject(429);
      userId = session.userId;
      users.set(userId, (users.get(userId) ?? 0) + 1);
      const headers: Record<string, string> = {
        upgrade: "websocket",
        connection: "Upgrade",
        "x-request-id": requestId,
      };
      for (const name of FORWARD) {
        const value = request.headers[name];
        if (typeof value === "string") headers[name] = value;
      }
      upstreamStarted = Date.now();
      try {
        upstreamRequest = httpRequest(
          new URL(request.url!, options.upstreamOrigin),
          { headers, agent: false, maxHeaderSize: 16_384 },
        );
        upstreamRequest.on("error", () => reject(502));
        upstreamRequest.on("response", (response) => {
          upstreamResponse = response;
          if (ended) {
            response.destroy();
            return;
          }
          let size = 0;
          response.on("error", () => reject(502));
          response.on("aborted", () => reject(502));
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > BODY_LIMIT) reject(502);
          });
          response.on("end", () => {
            const status = response.statusCode ?? 502;
            reject(
              response.complete && status >= 400 && status <= 599
                ? status
                : 502,
            );
          });
        });
        upstreamRequest.on("upgrade", (response, peer, upstreamHead) => {
          upstreamSocket = peer;
          peer.on("error", close);
          peer.on("end", close);
          peer.on("close", close);
          if (ended) {
            peer.destroy();
            return;
          }
          peer.pause();
          socket.pause();
          socket.off("data", collectEarlyBytes);
          let responseHeaders: string;
          try {
            responseHeaders = serializeHandshake(
              request,
              response,
              session.setCookies,
              requestId,
            );
          } catch {
            reject(502);
            return;
          }
          clearTimeout(handshakeTimer);
          upgraded = true;
          log("upgraded", 101);
          function touch() {
            clearTimeout(idleTimer);
            idleTimer = setTimeout(close, 120_000);
            idleTimer.unref();
          }
          touch();
          socket.on("data", touch);
          peer.on("data", touch);
          // The stream owns backpressure. Opaque bytes (including head buffers) are never parsed as frames.
          pipeAfterHead(
            peer,
            socket,
            Buffer.concat([Buffer.from(responseHeaders), upstreamHead]),
          );
          pipeAfterHead(socket, peer, Buffer.concat(earlyChunks));
          earlyChunks.length = 0;
        });
        upstreamRequest.end();
      } catch {
        reject(502);
      }
    }
  };

  return Object.assign(handler, {
    closeWebSockets(): void {
      draining = true;
      for (const close of connections) close();
    },
  });
}

function pipeAfterHead(
  source: Duplex,
  destination: Duplex,
  head: Buffer,
): void {
  const start = () => {
    if (!source.destroyed && !destination.destroyed) source.pipe(destination);
  };
  if (head.length && !destination.write(head)) destination.once("drain", start);
  else start();
}

function validateHeaders(
  message: IncomingMessage,
  allowSetCookie = false,
): void {
  const seen = new Set<string>();
  for (let i = 0; i < message.rawHeaders.length; i += 2) {
    const name = message.rawHeaders[i]!.toLowerCase();
    validateHeaderValue(name, message.rawHeaders[i + 1]);
    if (seen.has(name) && !(allowSetCookie && name === "set-cookie"))
      throw new Error("duplicate_header");
    seen.add(name);
  }
}

function tokens(value: string | undefined): string[] {
  if (value === undefined) return [];
  const values = value.split(",").map((s) => s.trim());
  if (
    values.some((s) => !TOKEN.test(s)) ||
    new Set(values).size !== values.length
  )
    throw new Error("invalid_tokens");
  return values;
}

function extensions(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(",").map((entry) => {
    const [name, ...parameters] = entry.split(";").map((s) => s.trim());
    if (!name || !TOKEN.test(name)) throw new Error("invalid_extension");
    for (const parameter of parameters) {
      const match = /^([^=]+)(?:=(.+))?$/.exec(parameter);
      if (
        !match ||
        !TOKEN.test(match[1]!) ||
        (match[2] !== undefined &&
          !TOKEN.test(match[2].replace(/^"(.*)"$/, "$1")))
      )
        throw new Error("invalid_extension");
    }
    return name;
  });
}

function validateClientHandshake(request: IncomingMessage): void {
  validateHeaders(request);
  const key = request.headers["sec-websocket-key"];
  if (
    request.method !== "GET" ||
    request.httpVersion !== "1.1" ||
    request.headers.upgrade?.toLowerCase() !== "websocket" ||
    !tokens(request.headers.connection).some(
      (t) => t.toLowerCase() === "upgrade",
    ) ||
    request.headers["sec-websocket-version"] !== "13" ||
    typeof key !== "string" ||
    !/^[A-Za-z\d+/]{22}==$/.test(key) ||
    Buffer.from(key, "base64").toString("base64") !== key ||
    request.headers["transfer-encoding"] !== undefined ||
    request.headers.expect !== undefined ||
    (request.headers["content-length"] !== undefined &&
      request.headers["content-length"] !== "0")
  )
    throw new Error("invalid_handshake");
  tokens(request.headers["sec-websocket-protocol"] as string | undefined);
  extensions(request.headers["sec-websocket-extensions"] as string | undefined);
}

function serializeHandshake(
  request: IncomingMessage,
  response: IncomingMessage,
  cookies: readonly string[],
  requestId: string,
): string {
  validateHeaders(response, true);
  const accept = createHash("sha1")
    .update(
      request.headers["sec-websocket-key"] +
        "258EAFA5-E914-47DA-95CA-C5AB0DC85B11",
    )
    .digest("base64");
  if (
    response.statusCode !== 101 ||
    response.headers.upgrade?.toLowerCase() !== "websocket" ||
    !tokens(response.headers.connection).some(
      (t) => t.toLowerCase() === "upgrade",
    ) ||
    response.headers["sec-websocket-accept"] !== accept ||
    response.headers["content-length"] !== undefined ||
    response.headers["transfer-encoding"] !== undefined
  )
    throw new Error("invalid_handshake");
  const selected = tokens(
    response.headers["sec-websocket-protocol"] as string | undefined,
  );
  if (
    selected.length > 1 ||
    selected.some(
      (p) =>
        !tokens(
          request.headers["sec-websocket-protocol"] as string | undefined,
        ).includes(p),
    )
  )
    throw new Error("unsolicited_protocol");
  const offered = extensions(
    request.headers["sec-websocket-extensions"] as string | undefined,
  );
  const negotiated = extensions(
    response.headers["sec-websocket-extensions"] as string | undefined,
  );
  if (
    new Set(negotiated).size !== negotiated.length ||
    negotiated.some((e) => !offered.includes(e))
  )
    throw new Error("unsolicited_extension");
  let result = `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n`;
  for (const name of ["sec-websocket-protocol", "sec-websocket-extensions"]) {
    const value = response.headers[name];
    if (value !== undefined) result += `${name}: ${value}\r\n`;
  }
  for (const cookie of [...cookies, ...(response.headers["set-cookie"] ?? [])])
    result += `Set-Cookie: ${cookie}\r\n`;
  return result + `X-Request-Id: ${requestId}\r\n\r\n`;
}

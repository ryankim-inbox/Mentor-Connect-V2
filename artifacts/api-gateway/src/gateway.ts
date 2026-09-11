import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";

import {
  resolvePublicRoute,
  type PublicRoute,
  type PublicRouteMatch,
} from "./route-policy.js";

import {
  publicError,
  projectProfile,
  projectPublicPayload,
} from "./public-contract.js";

const DEFAULT_UPSTREAM_ORIGIN = "http://127.0.0.1:8181";
const DEFAULT_REQUEST_BODY_LIMIT_BYTES = 1_048_576;
const DEFAULT_RESPONSE_BODY_LIMIT_BYTES = 2_097_152;
const DEFAULT_UPSTREAM_TIMEOUT_MS = 5_000;
const DEFAULT_REQUEST_BODY_TIMEOUT_MS = 10_000;
const MAX_REQUEST_TARGET_LENGTH = 8_192;
const SELF_PROFILE_UPDATE_BODY_LIMIT_BYTES = 16 * 1024;
const PRACTICE_LOCATION_TEST_BODY_LIMIT_BYTES = 16 * 1024;

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  ...HOP_BY_HOP_RESPONSE_HEADERS,
  "content-encoding",
  "content-length",
  "location",
  "server",
  "via",
  "x-powered-by",
]);

const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "authorization",
  "content-type",
  "cookie",
  "user-agent",
] as const;

export interface GatewayLogger {
  info(
    event: string,
    fields: Readonly<Record<string, boolean | number | string>>,
  ): void;
}

export interface GatewayOptions {
  readonly upstreamOrigin?: string;
  readonly requestBodyLimitBytes?: number;
  readonly responseBodyLimitBytes?: number;
  readonly upstreamTimeoutMs?: number;
  readonly requestBodyTimeoutMs?: number;
  readonly maintenanceMode?: boolean;
  readonly logger?: GatewayLogger;
}

interface GatewayConfig {
  readonly upstreamOrigin: URL;
  readonly requestBodyLimitBytes: number;
  readonly responseBodyLimitBytes: number;
  readonly upstreamTimeoutMs: number;
  readonly requestBodyTimeoutMs: number;
  readonly maintenanceMode: boolean;
  readonly logger: GatewayLogger;
}

interface RequestTarget {
  readonly pathname: string;
  readonly hasQuery: boolean;
}

interface UpstreamResponse {
  readonly response: Response;
  readonly body: Buffer;
}

interface SessionVerification {
  readonly userId: number;
  readonly setCookies: readonly string[];
}

class GatewayHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

class ClientDisconnectedError extends Error {}
class UpstreamTimeoutError extends Error {}
class UpstreamFailureError extends Error {}
class UpstreamResponseTooLargeError extends Error {}

const defaultLogger: GatewayLogger = {
  info(event, fields) {
    // Only fixed event names, canonical paths, method, status, and correlation
    // IDs are supplied to this logger. Request bodies and credential headers
    // never enter the logging surface.
    console.info(JSON.stringify({ event, ...fields }));
  },
};

export function createGatewayServer(options: GatewayOptions = {}): Server {
  const config = resolveGatewayConfig(options);
  const server = createServer((request, response) => {
    void handleRequest(request, response, config);
  });

  // Do not allow Node to automatically send 100 Continue before the request
  // has passed the gateway's duplicate-header and route checks.
  server.on("checkContinue", (request, response) => {
    void handleRequest(request, response, config);
  });

  // WebSocket support is deliberately absent until Slice 06. Reject every
  // upgrade before an upstream connection can be created.
  server.on("upgrade", (request, socket) => {
    rejectUpgrade(request, socket, config);
  });

  server.on("clientError", (_error, socket) => {
    socket.end(
      "HTTP/1.1 400 Bad Request\r\n" +
        "Connection: close\r\n" +
        "Content-Length: 0\r\n\r\n",
    );
  });

  return server;
}

export function resolveGatewayConfig(
  options: GatewayOptions = {},
): GatewayConfig {
  const upstreamOrigin = new URL(
    options.upstreamOrigin ??
      process.env.GATEWAY_UPSTREAM_ORIGIN ??
      DEFAULT_UPSTREAM_ORIGIN,
  );

  assertPrivateUpstream(upstreamOrigin);

  return {
    upstreamOrigin,
    requestBodyLimitBytes: resolvePositiveInteger(
      options.requestBodyLimitBytes,
      process.env.GATEWAY_MAX_BODY_BYTES,
      DEFAULT_REQUEST_BODY_LIMIT_BYTES,
      "GATEWAY_MAX_BODY_BYTES",
    ),
    responseBodyLimitBytes: resolvePositiveInteger(
      options.responseBodyLimitBytes,
      process.env.GATEWAY_MAX_RESPONSE_BYTES,
      DEFAULT_RESPONSE_BODY_LIMIT_BYTES,
      "GATEWAY_MAX_RESPONSE_BYTES",
    ),
    upstreamTimeoutMs: resolvePositiveInteger(
      options.upstreamTimeoutMs,
      process.env.GATEWAY_UPSTREAM_TIMEOUT_MS,
      DEFAULT_UPSTREAM_TIMEOUT_MS,
      "GATEWAY_UPSTREAM_TIMEOUT_MS",
    ),
    requestBodyTimeoutMs: resolvePositiveInteger(
      options.requestBodyTimeoutMs,
      process.env.GATEWAY_BODY_TIMEOUT_MS,
      DEFAULT_REQUEST_BODY_TIMEOUT_MS,
      "GATEWAY_BODY_TIMEOUT_MS",
    ),
    maintenanceMode:
      options.maintenanceMode ??
      process.env.GATEWAY_MAINTENANCE_MODE === "true",
    logger: options.logger ?? defaultLogger,
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: GatewayConfig,
): Promise<void> {
  const requestId = randomUUID();
  const clientAbortController = new AbortController();
  let clientDisconnected = false;

  const abortForDisconnectedClient = () => {
    clientDisconnected = true;
    clientAbortController.abort();
  };

  const abortForClosedResponse = () => {
    if (!response.writableEnded) {
      abortForDisconnectedClient();
    }
  };

  request.once("aborted", abortForDisconnectedClient);
  response.once("close", abortForClosedResponse);

  try {
    const target = parseRequestTarget(request.url);
    validateGenericRequestHeaders(request, config);

    const method = request.method?.toUpperCase() ?? "GET";

    if (method === "GET" && target.pathname === "/livez" && !target.hasQuery) {
      drainRequest(request);
      sendJson(response, 200, { status: "ok" }, requestId);
      log(config, "gateway.livez", {
        method,
        path: target.pathname,
        requestId,
        status: 200,
      });
      return;
    }

    const policy = resolveGatewayRoute(method, request.url ?? "");
    if (!policy) {
      drainRequest(request);
      sendGatewayError(response, 404, "not_found", requestId);
      log(config, "gateway.denied", {
        method,
        path: target.pathname,
        requestId,
        status: 404,
      });
      return;
    }

    if (policy.family === "users" && policy.resourceId !== undefined) {
      await handleSelfProfileRequest(
        request,
        response,
        config,
        requestId,
        policy,
        clientAbortController.signal,
      );
      return;
    }

    const authenticationDependentGet =
      method === "GET" && policy.authentication !== "none";
    if (authenticationDependentGet) {
      response.setHeader(
        "vary",
        mergeVaryHeader(response.getHeader("vary"), "Cookie"),
      );
    }

    if (config.maintenanceMode) {
      drainRequest(request);
      sendGatewayError(response, 503, "maintenance", requestId);
      log(config, "gateway.maintenance_denied", {
        method,
        path: target.pathname,
        requestId,
        status: 503,
      });
      return;
    }

    const routeBodyLimit = getRouteBodyLimit(policy, config);
    validateRouteHeaders(request, policy, routeBodyLimit);

    if (policy.authentication !== "none" && !hasCookie(request)) {
      drainRequest(request);
      sendGatewayError(response, 401, "unauthorized", requestId);
      log(config, "gateway.unauthorized", {
        method,
        path: target.pathname,
        requestId,
        status: 401,
      });
      return;
    }

    let sessionVerification: SessionVerification | undefined;
    if (policy.authentication === "session") {
      sessionVerification = await verifySession(
        request,
        config,
        requestId,
        clientAbortController.signal,
      );
    }

    const body = await readRequestBody(
      request,
      policy.allowsBody ? routeBodyLimit : 0,
      policy.allowsBody,
      config.requestBodyTimeoutMs,
      clientAbortController.signal,
    );

    const upstream = await fetchUpstream(
      request,
      method,
      policy.upstreamPath,
      body,
      config,
      requestId,
      clientAbortController.signal,
    );

    if (clientDisconnected) {
      return;
    }

    sendUpstreamResponse(
      response,
      upstream,
      requestId,
      sessionVerification?.setCookies,
      authenticationDependentGet,
      policy,
    );
    log(config, "gateway.proxied", {
      method,
      path: target.pathname,
      requestId,
      status: upstream.response.status,
    });
  } catch (error) {
    if (clientDisconnected || error instanceof ClientDisconnectedError) {
      log(config, "gateway.client_disconnected", { requestId });
      return;
    }

    if (error instanceof GatewayHttpError) {
      drainRequest(request);
      sendGatewayError(response, error.status, error.code, requestId);
      log(config, "gateway.rejected", {
        requestId,
        status: error.status,
        reason: error.code,
      });
      return;
    }

    if (error instanceof UpstreamTimeoutError) {
      sendGatewayError(response, 504, "upstream_timeout", requestId);
      log(config, "gateway.upstream_timeout", { requestId, status: 504 });
      return;
    }

    if (error instanceof UpstreamResponseTooLargeError) {
      sendGatewayError(response, 502, "upstream_response_too_large", requestId);
      log(config, "gateway.upstream_response_too_large", {
        requestId,
        status: 502,
      });
      return;
    }

    if (error instanceof UpstreamFailureError) {
      sendGatewayError(response, 502, "upstream_unavailable", requestId);
      log(config, "gateway.upstream_unavailable", { requestId, status: 502 });
      return;
    }

    sendGatewayError(response, 500, "gateway_error", requestId);
    log(config, "gateway.unexpected_error", { requestId, status: 500 });
  } finally {
    request.removeListener("aborted", abortForDisconnectedClient);
    response.removeListener("close", abortForClosedResponse);
  }
}

function rejectUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  config: GatewayConfig,
): void {
  const requestId = randomUUID();
  // Upgrades never join an upstream connection. Keep their external response
  // distinct from ordinary HTTP quarantine requests: the WebSocket handshake
  // must always terminate with 403 before an upgrade can be established.
  const body = Buffer.from(
    JSON.stringify({ error: "websocket_unavailable", requestId }),
  );

  socket.write(
    "HTTP/1.1 403 Forbidden\r\n" +
      "Content-Type: application/json; charset=utf-8\r\n" +
      "Cache-Control: no-store\r\n" +
      "Connection: close\r\n" +
      "Content-Length: " +
      body.length +
      "\r\n" +
      "X-Request-Id: " +
      requestId +
      "\r\n\r\n",
  );
  socket.end(body);

  log(config, "gateway.upgrade_denied", {
    method: request.method?.toUpperCase() ?? "GET",
    requestId,
    routeFamily: "websocket",
    status: 403,
  });
}

function assertPrivateUpstream(upstreamOrigin: URL): void {
  const isLoopback =
    upstreamOrigin.hostname === "127.0.0.1" ||
    upstreamOrigin.hostname === "[::1]" ||
    upstreamOrigin.hostname === "::1";

  if (
    upstreamOrigin.protocol !== "http:" ||
    !isLoopback ||
    upstreamOrigin.username ||
    upstreamOrigin.password ||
    upstreamOrigin.pathname !== "/" ||
    upstreamOrigin.search ||
    upstreamOrigin.hash
  ) {
    throw new Error(
      "GATEWAY_UPSTREAM_ORIGIN must be an http loopback origin without a path, query, or credentials.",
    );
  }
}

function resolvePositiveInteger(
  explicitValue: number | undefined,
  environmentValue: string | undefined,
  fallback: number,
  name: string,
): number {
  const candidate =
    explicitValue ??
    (environmentValue === undefined ? fallback : Number(environmentValue));

  if (!Number.isSafeInteger(candidate) || candidate <= 0) {
    throw new Error(name + " must be a positive integer.");
  }

  return candidate;
}

function parseRequestTarget(rawTarget: string | undefined): RequestTarget {
  if (!rawTarget || rawTarget.length > MAX_REQUEST_TARGET_LENGTH) {
    throw new GatewayHttpError(400, "malformed_url");
  }

  if (
    !rawTarget.startsWith("/") ||
    rawTarget.startsWith("//") ||
    rawTarget.includes("#") ||
    rawTarget.includes("\\") ||
    hasInvalidPercentEncoding(rawTarget)
  ) {
    throw new GatewayHttpError(400, "malformed_url");
  }

  const queryIndex = rawTarget.indexOf("?");
  const rawPath =
    queryIndex === -1 ? rawTarget : rawTarget.slice(0, queryIndex);

  // No approved API path contains percent encoding, dot segments, repeated
  // slashes, or uppercase letters. Refuse alternate spellings before matching
  // the route policy so an upstream router cannot normalize them differently.
  if (
    rawPath.includes("%") ||
    rawPath.includes("//") ||
    rawPath.split("/").some((segment) => segment === "." || segment === "..") ||
    !/^\/[a-z0-9_/-]*$/.test(rawPath)
  ) {
    throw new GatewayHttpError(400, "malformed_url");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawTarget, "http://gateway.invalid");
  } catch {
    throw new GatewayHttpError(400, "malformed_url");
  }

  if (parsed.pathname !== rawPath) {
    throw new GatewayHttpError(400, "malformed_url");
  }

  return { pathname: rawPath, hasQuery: queryIndex !== -1 };
}

function hasInvalidPercentEncoding(value: string): boolean {
  try {
    decodeURIComponent(value);
    return false;
  } catch {
    return true;
  }
}

function validateGenericRequestHeaders(
  request: IncomingMessage,
  config: GatewayConfig,
): void {
  if (hasDuplicateHeaders(request.rawHeaders)) {
    throw new GatewayHttpError(400, "duplicate_headers");
  }

  if (request.headers["transfer-encoding"] !== undefined) {
    throw new GatewayHttpError(400, "unsupported_transfer_encoding");
  }

  if (request.headers.expect !== undefined) {
    throw new GatewayHttpError(417, "expectation_failed");
  }

  const contentLength = getHeader(request, "content-length");
  if (contentLength === undefined) {
    return;
  }

  if (!/^\d+$/.test(contentLength)) {
    throw new GatewayHttpError(400, "invalid_content_length");
  }

  const bytes = Number(contentLength);
  if (!Number.isSafeInteger(bytes)) {
    throw new GatewayHttpError(400, "invalid_content_length");
  }

  if (bytes > config.requestBodyLimitBytes) {
    throw new GatewayHttpError(413, "request_body_too_large");
  }
}

function validateRouteHeaders(
  request: IncomingMessage,
  policy: PublicRoute,
  bodyLimitBytes: number,
): void {
  const contentLength = getHeader(request, "content-length");
  const bytes = contentLength === undefined ? 0 : Number(contentLength);

  if (!policy.allowsBody && bytes > 0) {
    throw new GatewayHttpError(400, "request_body_not_allowed");
  }

  if (bytes > bodyLimitBytes) {
    throw new GatewayHttpError(413, "request_body_too_large");
  }

  if (policy.requiresJson) {
    const contentType = getHeader(request, "content-type");
    if (!contentType || !isJsonContentType(contentType)) {
      throw new GatewayHttpError(415, "json_content_type_required");
    }
  }
}

function getRouteBodyLimit(policy: PublicRoute, config: GatewayConfig): number {
  return policy.template === "/api/practice/locations/test"
    ? Math.min(
        config.requestBodyLimitBytes,
        PRACTICE_LOCATION_TEST_BODY_LIMIT_BYTES,
      )
    : config.requestBodyLimitBytes;
}

function hasDuplicateHeaders(rawHeaders: readonly string[]): boolean {
  const seen = new Set<string>();

  for (let index = 0; index < rawHeaders.length; index += 2) {
    const normalized = rawHeaders[index]?.toLowerCase();
    if (!normalized) {
      return true;
    }

    if (seen.has(normalized)) {
      return true;
    }

    seen.add(normalized);
  }

  return false;
}

function getHeader(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];

  if (Array.isArray(value)) {
    throw new GatewayHttpError(400, "duplicate_headers");
  }

  return value;
}

function isJsonContentType(contentType: string): boolean {
  const [mediaType] = contentType.split(";", 1);
  return mediaType?.trim().toLowerCase() === "application/json";
}

function resolveGatewayRoute(
  method: string,
  target: string,
): PublicRouteMatch | undefined {
  try {
    return resolvePublicRoute(method, target);
  } catch (error) {
    if (error instanceof TypeError && error.message === "invalid_query") {
      throw new GatewayHttpError(400, "invalid_query");
    }
    throw error;
  }
}

function hasCookie(request: IncomingMessage): boolean {
  const cookie = getHeader(request, "cookie");
  return typeof cookie === "string" && cookie.trim().length > 0;
}

async function handleSelfProfileRequest(
  request: IncomingMessage,
  response: ServerResponse,
  config: GatewayConfig,
  requestId: string,
  policy: PublicRouteMatch,
  clientSignal: AbortSignal,
): Promise<void> {
  const { method, resourceId: requestedUserId } = policy;
  if (requestedUserId === undefined) {
    throw new GatewayHttpError(404, "not_found");
  }
  if (method === "GET") {
    response.setHeader(
      "vary",
      mergeVaryHeader(response.getHeader("vary"), "Cookie"),
    );
  }
  if (config.maintenanceMode) {
    drainRequest(request);
    sendGatewayError(response, 503, "maintenance", requestId);
    log(config, "gateway.maintenance_denied", {
      method,
      requestId,
      routeFamily: "self-profile",
      status: 503,
    });
    return;
  }

  validateRouteHeaders(request, policy, config.requestBodyLimitBytes);

  let body: Buffer | undefined;
  if (method === "PATCH") {
    body = await readRequestBody(
      request,
      Math.min(
        config.requestBodyLimitBytes,
        SELF_PROFILE_UPDATE_BODY_LIMIT_BYTES,
      ),
      true,
      config.requestBodyTimeoutMs,
      clientSignal,
    );
    body = validateSelfProfilePatch(body);
  } else {
    if (!hasCookie(request)) {
      drainRequest(request);
      sendGatewayError(response, 401, "unauthorized", requestId);
      log(config, "gateway.unauthorized", {
        method,
        requestId,
        routeFamily: "self-profile",
        status: 401,
      });
      return;
    }

    await readRequestBody(
      request,
      0,
      false,
      config.requestBodyTimeoutMs,
      clientSignal,
    );
  }

  if (!hasCookie(request)) {
    sendGatewayError(response, 401, "unauthorized", requestId);
    log(config, "gateway.unauthorized", {
      method,
      requestId,
      routeFamily: "self-profile",
      status: 401,
    });
    return;
  }

  const session = await verifySession(request, config, requestId, clientSignal);
  if (method === "PATCH" && session.userId !== requestedUserId) {
    sendGatewayError(response, 404, "not_found", requestId);
    log(config, "gateway.self_profile_denied", {
      method,
      outcome: "id_mismatch",
      requestId,
      routeFamily: "self-profile",
      status: 404,
    });
    return;
  }

  const upstream = await fetchUpstream(
    request,
    method,
    policy.upstreamPath,
    body,
    config,
    requestId,
    clientSignal,
  );

  sendSelfProfileResponse(
    response,
    upstream,
    requestedUserId,
    method,
    requestId,
    session.setCookies,
  );
  log(config, "gateway.self_profile_proxied", {
    method,
    requestId,
    routeFamily: "self-profile",
    status: upstream.response.status,
  });
}

function validateSelfProfilePatch(body: Buffer | undefined): Buffer {
  if (!body || body.length === 0) {
    throw new GatewayHttpError(400, "invalid_profile_update");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    throw new GatewayHttpError(400, "invalid_profile_update");
  }

  if (!isJsonRecord(payload)) {
    throw new GatewayHttpError(400, "invalid_profile_update");
  }

  const allowedFields = new Set(["name", "bio", "subjects"]);
  const keys = Object.keys(payload);
  if (keys.length === 0 || keys.some((key) => !allowedFields.has(key))) {
    throw new GatewayHttpError(400, "invalid_profile_update");
  }

  const sanitized: Record<string, string | string[] | null> = {};

  if (Object.prototype.hasOwnProperty.call(payload, "name")) {
    const name = readBoundedString(payload.name, 120);
    if (!name) {
      throw new GatewayHttpError(400, "invalid_profile_update");
    }
    sanitized.name = name;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "bio")) {
    if (payload.bio !== null && typeof payload.bio !== "string") {
      throw new GatewayHttpError(400, "invalid_profile_update");
    }
    if (
      typeof payload.bio === "string" &&
      Buffer.byteLength(payload.bio, "utf8") > 2_000
    ) {
      throw new GatewayHttpError(400, "invalid_profile_update");
    }
    sanitized.bio = payload.bio;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "subjects")) {
    const subjects = sanitizeSubjects(payload.subjects);
    if (!subjects) {
      throw new GatewayHttpError(400, "invalid_profile_update");
    }
    sanitized.subjects = subjects;
  }

  return Buffer.from(JSON.stringify(sanitized));
}

function sendSelfProfileResponse(
  response: ServerResponse,
  upstream: UpstreamResponse,
  expectedUserId: number,
  method: string,
  requestId: string,
  sessionSetCookies: readonly string[],
): void {
  const setCookies = [
    ...sessionSetCookies,
    ...getSetCookies(upstream.response.headers),
  ];
  if (setCookies.length > 0) response.setHeader("set-cookie", setCookies);
  if (upstream.response.status >= 400) {
    sendJson(
      response,
      upstream.response.status,
      publicError(upstream.response.status),
      requestId,
    );
    return;
  }
  if (!upstream.response.ok) throw new UpstreamFailureError();

  const profile = sanitizeSelfProfile(upstream.body, expectedUserId);
  if (!profile) {
    throw new UpstreamFailureError();
  }

  response.setHeader("vary", "Cookie");
  sendJson(response, 200, profile, requestId);
}

function sanitizeSelfProfile(
  body: Buffer,
  expectedUserId: number,
): Record<string, unknown> | undefined {
  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    return undefined;
  }

  try {
    return projectProfile(payload, expectedUserId);
  } catch {
    return undefined;
  }
}

function sanitizeSubjects(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > 20) {
    return undefined;
  }

  const subjects: string[] = [];
  for (const entry of value) {
    const subject = readBoundedString(entry, 80);
    if (!subject) {
      return undefined;
    }
    subjects.push(subject);
  }

  return subjects;
}

function readBoundedString(
  value: unknown,
  maxBytes: number,
): string | undefined {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

async function verifySession(
  request: IncomingMessage,
  config: GatewayConfig,
  requestId: string,
  clientSignal: AbortSignal,
): Promise<SessionVerification> {
  const upstream = await fetchUpstream(
    request,
    "GET",
    "/api/auth/me",
    undefined,
    config,
    requestId,
    clientSignal,
  );

  if (upstream.response.status === 401 || upstream.response.status === 403) {
    throw new GatewayHttpError(401, "unauthorized");
  }

  if (!upstream.response.ok) {
    throw new UpstreamFailureError();
  }

  let payload: unknown;
  try {
    payload = JSON.parse(upstream.body.toString("utf8"));
  } catch {
    throw new UpstreamFailureError();
  }

  const userId = getSessionUserId(payload);
  if (userId === undefined) {
    throw new UpstreamFailureError();
  }

  return {
    userId,
    setCookies: getSetCookies(upstream.response.headers),
  };
}

function getSessionUserId(payload: unknown): number | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const id = (payload as Record<string, unknown>).id;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0
    ? id
    : undefined;
}

async function readRequestBody(
  request: IncomingMessage,
  limitBytes: number,
  allowsBody: boolean,
  timeoutMs: number,
  clientSignal: AbortSignal,
): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let byteCount = 0;
    let settled = false;

    const timeout = setTimeout(() => {
      fail(new GatewayHttpError(408, "request_body_timeout"));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      clientSignal.removeEventListener("abort", onAbort);
    };

    const fail = (error: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      drainRequest(request);
      reject(error);
    };

    const onData = (chunk: Buffer) => {
      if (!allowsBody) {
        fail(new GatewayHttpError(400, "request_body_not_allowed"));
        return;
      }

      byteCount += chunk.length;
      if (byteCount > limitBytes) {
        fail(new GatewayHttpError(413, "request_body_too_large"));
        return;
      }

      chunks.push(chunk);
    };

    const onEnd = () => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve(byteCount === 0 ? undefined : Buffer.concat(chunks));
    };

    const onError = () => fail(new ClientDisconnectedError());
    const onAbort = () => fail(new ClientDisconnectedError());

    request.on("data", onData);
    request.once("end", onEnd);
    request.once("error", onError);
    clientSignal.addEventListener("abort", onAbort, { once: true });
  });
}

async function fetchUpstream(
  request: IncomingMessage,
  method: string,
  pathname: string,
  body: Buffer | undefined,
  config: GatewayConfig,
  requestId: string,
  clientSignal: AbortSignal,
): Promise<UpstreamResponse> {
  const timeoutAbortController = new AbortController();
  let timedOut = false;
  const abortForClientDisconnect = () => timeoutAbortController.abort();
  clientSignal.addEventListener("abort", abortForClientDisconnect, {
    once: true,
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    timeoutAbortController.abort();
  }, config.upstreamTimeoutMs);

  try {
    const upstreamUrl = new URL(pathname, config.upstreamOrigin);
    const response = await fetch(upstreamUrl, {
      method,
      headers: buildUpstreamHeaders(request, requestId),
      body,
      redirect: "manual",
      signal: timeoutAbortController.signal,
    });

    const responseBody = await readUpstreamBody(
      response,
      config.responseBodyLimitBytes,
      timeoutAbortController.signal,
    );

    return { response, body: responseBody };
  } catch (error) {
    if (timedOut) {
      throw new UpstreamTimeoutError();
    }

    if (clientSignal.aborted) {
      throw new ClientDisconnectedError();
    }

    if (error instanceof UpstreamResponseTooLargeError) {
      throw error;
    }

    throw new UpstreamFailureError();
  } finally {
    clearTimeout(timeout);
    clientSignal.removeEventListener("abort", abortForClientDisconnect);
  }
}

function buildUpstreamHeaders(
  request: IncomingMessage,
  requestId: string,
): Headers {
  const headers = new Headers();

  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = getHeader(request, name);
    if (value && value.trim().length > 0) {
      headers.set(name, value);
    }
  }

  // A client-supplied correlation header is never trusted. The generated ID is
  // safe to log and lets the gateway and backend correlate a request without
  // recording credentials or request payloads.
  headers.set("x-request-id", requestId);
  return headers;
}

async function readUpstreamBody(
  response: Response,
  limitBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;

  try {
    while (true) {
      if (signal.aborted) {
        throw new ClientDisconnectedError();
      }

      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      byteCount += value.byteLength;
      if (byteCount > limitBytes) {
        await reader.cancel();
        throw new UpstreamResponseTooLargeError();
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

function sendUpstreamResponse(
  response: ServerResponse,
  upstream: UpstreamResponse,
  requestId: string,
  additionalSetCookies: readonly string[] | undefined,
  authenticationDependentGet: boolean,
  policy: PublicRouteMatch,
): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }

  for (const [name, value] of upstream.response.headers.entries()) {
    const normalizedName = name.toLowerCase();
    if (
      normalizedName === "set-cookie" ||
      STRIPPED_RESPONSE_HEADERS.has(normalizedName) ||
      !["content-type", "retry-after", "vary"].includes(normalizedName)
    ) {
      continue;
    }

    response.setHeader(name, value);
  }

  const setCookies = [
    ...(additionalSetCookies ?? []),
    ...getSetCookies(upstream.response.headers),
  ];
  if (setCookies.length > 0) {
    response.setHeader("set-cookie", setCookies);
  }

  if (authenticationDependentGet) {
    response.setHeader("cache-control", "no-store");
    response.setHeader(
      "vary",
      mergeVaryHeader(response.getHeader("vary"), "Cookie"),
    );
  }

  response.setHeader("cache-control", "no-store");
  if (upstream.response.status >= 400) {
    sendJson(
      response,
      upstream.response.status,
      publicError(upstream.response.status),
      requestId,
    );
    return;
  }
  if (upstream.response.status === 204) {
    response.writeHead(204, { "x-request-id": requestId });
    response.end();
    return;
  }
  let payload: unknown;
  try {
    payload = projectPublicPayload(
      JSON.parse(upstream.body.toString("utf8")),
      policy.template,
      policy.method,
    );
  } catch {
    sendGatewayError(response, 502, "backend_error", requestId);
    return;
  }
  sendJson(response, upstream.response.status, payload, requestId);
}

function mergeVaryHeader(
  existing: number | string | readonly string[] | undefined,
  requiredValue: string,
): string {
  const values = (Array.isArray(existing) ? existing : [existing])
    .flatMap((value) => String(value ?? "").split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  const seen = new Set();
  const merged = [];
  for (const value of [...values, requiredValue]) {
    const normalized = value.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      merged.push(value);
    }
  }
  return merged.join(", ");
}

function getSetCookies(headers: Headers): readonly string[] {
  const nodeHeaders = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof nodeHeaders.getSetCookie === "function") {
    return nodeHeaders.getSetCookie();
  }

  const setCookie = headers.get("set-cookie");
  return setCookie ? [setCookie] : [];
}

function sendGatewayError(
  response: ServerResponse,
  status: number,
  error: string,
  requestId: string,
): void {
  // Keep error bodies constant across anonymous, authenticated, and malformed
  // requests. Correlation remains available in the response header only.
  sendJson(response, status, { error }, requestId);
}

function sendJson(
  response: ServerResponse,
  status: number,
  payload: unknown,
  requestId: string,
): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }

  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": body.length,
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-request-id": requestId,
  });
  response.end(body);
}

function drainRequest(request: IncomingMessage): void {
  if (!request.readableEnded) {
    request.resume();
  }
}

function log(
  config: GatewayConfig,
  event: string,
  fields: Readonly<Record<string, boolean | number | string>>,
): void {
  config.logger.info(event, fields);
}

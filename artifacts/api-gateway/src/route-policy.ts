export const QUARANTINED_ROUTE_FAMILIES = {
  admin: "admin",
  pythonReports: "python-reports",
  matches: "matches",
  practice: "practice",
  requestMatch: "request-match",
  chat: "chat",
  dms: "dms",
  websocket: "websocket",
} as const;

export type QuarantinedRouteFamily =
  (typeof QUARANTINED_ROUTE_FAMILIES)[keyof typeof QUARANTINED_ROUTE_FAMILIES];

const MAX_PERCENT_DECODE_PASSES = 8;

function extractPath(requestTarget: string): string | undefined {
  const target = requestTarget.trim();

  if (!target || target === "*") {
    return undefined;
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(target)) {
    try {
      return new URL(target).pathname;
    } catch {
      return undefined;
    }
  }

  const endOfPath = target.search(/[?#]/);
  const path = endOfPath === -1 ? target : target.slice(0, endOfPath);

  return path.startsWith("/") ? path : undefined;
}

/**
 * Produces one security comparison form for an HTTP request target.
 *
 * This intentionally decodes more than once and treats a literal percent sign
 * as malformed. A false positive is a safe 400; a false negative could let an
 * encoded separator bypass the quarantine before the upstream sees it.
 */
export function normalizeInboundPath(requestTarget: string): string | undefined {
  const rawPath = extractPath(requestTarget);

  if (!rawPath) {
    return undefined;
  }

  let decodedPath = rawPath;

  for (let pass = 0; pass < MAX_PERCENT_DECODE_PASSES && decodedPath.includes("%"); pass += 1) {
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
      return undefined;
    }
  }

  if (decodedPath.includes("%") || /[\u0000-\u001f\u007f]/.test(decodedPath)) {
    return undefined;
  }

  const segments: string[] = [];

  for (const rawSegment of decodedPath.replaceAll("\\", "/").split("/")) {
    // Matrix/path parameters are not part of a route family. Treating them as
    // a distinct segment would make `/api/admin;v=1/...` a bypass candidate.
    const segment = rawSegment.split(";", 1)[0].toLowerCase();

    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return `/${segments.join("/")}`;
}

/**
 * Classifies sensitive route families without considering the HTTP method.
 * The returned value is deliberately coarse so it is safe to attach to a
 * security metric.
 */
export function classifyQuarantinedRoute(requestTarget: string): QuarantinedRouteFamily | undefined {
  const normalizedPath = normalizeInboundPath(requestTarget);

  if (!normalizedPath) {
    return undefined;
  }

  const segments = normalizedPath.slice(1).split("/");

  if (segments[0] === "ws") {
    return QUARANTINED_ROUTE_FAMILIES.websocket;
  }

  if (segments[0] !== "api") {
    return undefined;
  }

  if (segments[1] === QUARANTINED_ROUTE_FAMILIES.admin) {
    return QUARANTINED_ROUTE_FAMILIES.admin;
  }

  if (segments[1] === QUARANTINED_ROUTE_FAMILIES.pythonReports) {
    return QUARANTINED_ROUTE_FAMILIES.pythonReports;
  }

  if (segments[1] === QUARANTINED_ROUTE_FAMILIES.matches) {
    return QUARANTINED_ROUTE_FAMILIES.matches;
  }

  if (segments[1] === QUARANTINED_ROUTE_FAMILIES.practice) {
    return QUARANTINED_ROUTE_FAMILIES.practice;
  }

  if (segments[1] === QUARANTINED_ROUTE_FAMILIES.chat) {
    return QUARANTINED_ROUTE_FAMILIES.chat;
  }

  if (segments[1] === QUARANTINED_ROUTE_FAMILIES.dms) {
    return QUARANTINED_ROUTE_FAMILIES.dms;
  }

  // A request identifier is deliberately not parsed here: no spelling of an
  // identifier is safe to forward while the matching state transition is
  // quarantined. Match any normalized descendant as well, so a trailing path
  // segment cannot turn a blocked action into an upstream routing decision.
  if (segments[1] === "requests" && segments[3] === "match") {
    return QUARANTINED_ROUTE_FAMILIES.requestMatch;
  }

  return undefined;
}

/**
 * Only origin-form request targets are safe to proxy. Absolute-form and
 * protocol-relative forms are rejected rather than becoming an open proxy.
 */
export function isForwardableRequestTarget(requestTarget: string): boolean {
  return requestTarget.startsWith("/") &&
    !requestTarget.startsWith("//") &&
    !/[\r\n]/.test(requestTarget);
}

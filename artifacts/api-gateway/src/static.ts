import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

// Only actual client routes get index.html. API/WS and unknown assets stay 404.
const SPA_ROUTE =
  /^\/(?:login|register|dashboard(?:\/practice-lab)?|districts(?:\/[1-9]\d*)?|requests(?:\/(?:new|[1-9]\d*))?|profile(?:\/[1-9]\d*)?|settings|connections|recommendations|practice-lab|analytics|scheduling|admin\/reports)?$/;
const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

export async function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  directory: string,
  pathname: string,
): Promise<boolean> {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const spa = SPA_ROUTE.test(pathname);
  const asset = /^\/assets\/[A-Za-z0-9_/-]+\.[A-Za-z0-9]+$/.test(pathname);
  if (
    !spa &&
    !asset &&
    pathname !== "/favicon.ico" &&
    pathname !== "/favicon.svg"
  )
    return false;
  if (pathname.split("/").some((part) => part.startsWith("."))) return false;
  const type = MIME[path.extname(spa ? "index.html" : pathname)];
  if (!type) return false;
  try {
    const root = await realpath(directory);
    const file = path.join(root, spa ? "index.html" : pathname);
    const resolved = await realpath(file);
    if (!resolved.startsWith(root + path.sep) || resolved !== file)
      return false;
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 8 * 1024 * 1024) return false;
      const body =
        request.method === "HEAD" ? undefined : await handle.readFile();
      response.setHeader("content-type", type);
      response.setHeader("content-length", stat.size);
      response.setHeader(
        "cache-control",
        asset && /-[A-Za-z0-9_-]{8,}\./.test(pathname)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      );
      response.writeHead(200);
      response.end(body);
      return true;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

export function setSecurityHeaders(
  response: ServerResponse,
  publicOrigin: string,
): void {
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("x-frame-options", "DENY");
  response.setHeader("referrer-policy", "strict-origin-when-cross-origin");
  response.setHeader(
    "permissions-policy",
    "camera=(), microphone=(), geolocation=()",
  );
  response.setHeader(
    "content-security-policy",
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' ${publicOrigin.replace(/^http/, "ws")}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`,
  );
  if (publicOrigin.startsWith("https:"))
    response.setHeader("strict-transport-security", "max-age=31536000");
}

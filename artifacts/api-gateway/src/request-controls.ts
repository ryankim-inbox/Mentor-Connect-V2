import { createHash } from "node:crypto";

const WINDOW_MS = 60_000;
const MAX_ENTRIES = 10_000;

interface LimitEntry {
  count: number;
  startedAt: number;
}

export function validateAuthBody(
  kind: "login" | "register",
  body: Buffer | undefined,
): { body: Buffer; accountKey: string } {
  if (!body || body.length === 0) {
    throw new Error("invalid_auth_body");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    throw new Error("invalid_auth_body");
  }

  if (!isRecord(payload)) {
    throw new Error("invalid_auth_body");
  }

  const requiredKeys =
    kind === "login"
      ? ["email", "password"]
      : ["email", "name", "password", "role", "districtId"];
  const keys = Object.keys(payload);
  if (
    keys.length !== requiredKeys.length ||
    requiredKeys.some((key) => !Object.hasOwn(payload, key))
  ) {
    throw new Error("invalid_auth_body");
  }

  if (
    typeof payload.email !== "string" ||
    typeof payload.password !== "string" ||
    payload.password.length === 0 ||
    Buffer.byteLength(payload.password, "utf8") > 72
  ) {
    throw new Error("invalid_auth_body");
  }

  if (
    kind === "register" &&
    (!payload.email.toLowerCase().endsWith(".edu") ||
      typeof payload.name !== "string" ||
      typeof payload.role !== "string" ||
      !["mentor", "mentee", "both"].includes(payload.role) ||
      !Number.isSafeInteger(payload.districtId))
  ) {
    throw new Error("invalid_auth_body");
  }

  return {
    body,
    accountKey: createHash("sha256")
      .update(payload.email.trim().toLowerCase(), "utf8")
      .digest("hex"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function assertAllowedOrigin(
  origin: string | undefined,
  publicOrigin: string,
): void {
  if (origin !== publicOrigin) {
    throw new Error("origin_not_allowed");
  }
}

export function assertValidPublicOrigin(
  publicOrigin: string,
  allowLoopbackHttp = false,
): void {
  let parsed: URL;
  try {
    parsed = new URL(publicOrigin);
  } catch {
    throw new Error("GATEWAY_PUBLIC_ORIGIN must be a canonical public origin.");
  }

  const loopback =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "[::1]";
  const validProtocol =
    parsed.protocol === "https:" ||
    (allowLoopbackHttp && parsed.protocol === "http:" && loopback);

  if (publicOrigin !== parsed.origin || !validProtocol) {
    throw new Error(
      "GATEWAY_PUBLIC_ORIGIN must be a canonical HTTPS public origin or an explicitly enabled HTTP loopback origin.",
    );
  }
}

export function createLimiter(now: () => number): {
  take(key: string, limit: number): { allowed: boolean; retryAfter: number };
} {
  // ponytail: per-process counters; use a shared limiter only if deployment gains multiple gateway instances
  const entries = new Map<string, LimitEntry>();

  return {
    take(key, limit) {
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new Error("limit must be a positive integer");
      }

      const currentTime = now();
      let entry = entries.get(key);

      if (
        entry &&
        (currentTime < entry.startedAt ||
          currentTime - entry.startedAt >= WINDOW_MS)
      ) {
        entry = undefined;
        entries.delete(key);
      }

      if (!entry) {
        if (entries.size >= MAX_ENTRIES) {
          for (const [storedKey, storedEntry] of entries) {
            if (currentTime - storedEntry.startedAt >= WINDOW_MS) {
              entries.delete(storedKey);
            }
          }
        }

        if (entries.size >= MAX_ENTRIES) {
          let retryAfter = 60;
          for (const storedEntry of entries.values()) {
            retryAfter = Math.min(
              retryAfter,
              secondsUntilReset(storedEntry.startedAt, currentTime),
            );
          }
          return { allowed: false, retryAfter };
        }

        entries.set(key, { count: 1, startedAt: currentTime });
        return { allowed: true, retryAfter: 0 };
      }

      if (entry.count >= limit) {
        return {
          allowed: false,
          retryAfter: secondsUntilReset(entry.startedAt, currentTime),
        };
      }

      entry.count += 1;
      return { allowed: true, retryAfter: 0 };
    },
  };
}

function secondsUntilReset(startedAt: number, currentTime: number): number {
  return Math.max(1, Math.ceil((startedAt + WINDOW_MS - currentTime) / 1_000));
}

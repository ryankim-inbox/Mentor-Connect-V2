import { z } from "zod";
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

  if (kind === "register") {
    const name = readDisplayName(payload.name);
    if (!name) throw new Error("invalid_auth_body");
    payload.name = name;
    body = Buffer.from(JSON.stringify(payload));
  }

  return {
    body,
    accountKey: createHash("sha256")
      .update(payload.email.trim().toLowerCase(), "utf8")
      .digest("hex"),
  };
}

// Names trim the union of Python whitespace and JavaScript trim whitespace.
export function readDisplayName(value: unknown): string | undefined {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > 120) {
    return undefined;
  }
  return (
    value.replace(/^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/g, "") ||
    undefined
  );
}

export function readBoundedString(
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

// Strict validation for identity-bearing mutations. Parsing failures are handled
// as fixed public errors; raw bodies and verification tokens never enter logs.
export function validateSensitiveBody(
  path: string,
  method: string,
  body: Buffer | undefined,
): Buffer | undefined {
  const positive = z.number().int().positive().safe();
  const boundedText = (max: number) =>
    z
      .string()
      .min(1)
      .max(max)
      .refine((v) => v.trim().length > 0);
  const requestText = (maxBytes: number) =>
    z
      .string()
      .refine((v) => !!v.trim() && Buffer.byteLength(v, "utf8") <= maxBytes);
  const tags = z
    .array(positive)
    .max(20)
    .refine((v) => new Set(v).size === v.length)
    .nullable()
    .optional();
  const requestFields = {
    title: requestText(200).nullable().optional(),
    description: requestText(4000).nullable().optional(),
    tagIds: tags,
  };
  let schema: z.ZodTypeAny | undefined;
  if (path === "/api/auth/verification/confirm")
    schema = z
      .object({
        token: z
          .string()
          .min(43)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/),
      })
      .strict();
  else if (path === "/api/admin/reports/{id}")
    schema = z
      .object({
        status: z.enum(["open", "reviewing", "resolved", "dismissed"]),
        note: z.string().max(2000).nullable().optional(),
      })
      .strict();
  else if (
    path === "/api/requests/{id}/comments/{commentId}" &&
    method === "PATCH"
  )
    schema = z.object({ body: boundedText(2000) }).strict();
  else if (path === "/api/requests/{id}/comments" && method === "POST")
    schema = z
      .object({
        body: boundedText(2000),
        parentId: positive.nullable().optional(),
        clientCommentId: z.string().uuid(),
      })
      .strict();
  else if (path.endsWith("/applications/{applicationId}") && method === "PATCH")
    schema = z
      .object({ action: z.enum(["accept", "reject", "cancel"]) })
      .strict();
  else if (path === "/api/reports")
    schema = z
      .object({
        reportedUserId: positive,
        reason: z.enum([
          "spam",
          "harassment",
          "inappropriate",
          "fake_account",
          "other",
        ]),
        description: z.string().max(2000).nullable().optional(),
      })
      .strict();
  else if (path === "/api/blocks" && method === "POST")
    schema = z.object({ blockedUserId: positive }).strict();
  else if (
    (path.startsWith("/api/chat/") || path.startsWith("/api/dms/")) &&
    path.endsWith("/messages") &&
    method === "POST"
  )
    schema = z
      .object({
        body: z.string(),
        clientMessageId: z.string().uuid().nullable().optional(),
      })
      .strict();
  else if (path === "/api/dms/start")
    schema = z.object({ toUserId: positive }).strict();
  else if (path === "/api/matches" && method === "POST")
    schema = z
      .object({
        question_id: positive,
        limit: z.number().int().min(1).max(20).optional(),
      })
      .strict();
  else if (path === "/api/requests" && method === "POST")
    schema = z
      .object({
        ...requestFields,
        districtId: positive,
        title: requestText(200),
        description: requestText(4000),
        role: z.enum(["mentor", "mentee"]),
        preferredTimes: z
          .array(
            z
              .string()
              .regex(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) ([01][0-9]|2[0-3]):00$/),
          )
          .max(30)
          .refine((v) => new Set(v).size === v.length)
          .nullable()
          .optional(),
      })
      .strict();
  else if (path === "/api/requests/{id}" && method === "PATCH")
    schema = z
      .object({
        ...requestFields,
        status: z.enum(["open", "matched", "closed"]).nullable().optional(),
      })
      .strict();
  if (schema) {
    const payload = schema.parse(JSON.parse(body?.toString("utf8") ?? ""));
    if (
      (path.startsWith("/api/chat/") || path.startsWith("/api/dms/")) &&
      path.endsWith("/messages") &&
      method === "POST"
    ) {
      const text = payload.body.replace(
        /^[\s\u0085\u001c-\u001f]+|[\s\u0085\u001c-\u001f]+$/g,
        "",
      );
      if (!text || [...text].length > 2000)
        throw new Error("invalid_message_content");
    }
  }
  return body;
}

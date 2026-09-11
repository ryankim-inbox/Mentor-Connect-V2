import { z } from "zod";

const id = z.number().int().positive().safe();
const text = z.string().min(1);
const timestamp = z.string().min(1).max(128);
export const profileSummarySchema = z.object({
  id,
  name: text.max(120),
  subjects: z.array(text.max(80)).max(20),
  createdAt: timestamp,
});
export type ProfileSummary = z.infer<typeof profileSummarySchema>;
export function projectProfile(
  payload: unknown,
  expectedId: number,
): ProfileSummary {
  const profile = profileSummarySchema.parse(payload);
  if (profile.id !== expectedId) throw new TypeError("invalid_profile");
  return profile;
}
export function publicError(status: number): { error: string } {
  return {
    error:
      (
        {
          400: "invalid_input",
          422: "invalid_input",
          401: "unauthorized",
          403: "forbidden",
          404: "not_found",
          409: "conflict",
          429: "rate_limited",
        } as Record<number, string>
      )[status] ?? (status >= 500 ? "backend_error" : "invalid_input"),
  };
}
const todo = z.object({
  status: z.literal("todo"),
  mission: z.number().int().optional(),
  message: z.string().max(1000),
  guide: z.string().max(500).optional(),
});
const room = z.object({
  id,
  type: z.enum(["global", "district"]),
  districtId: id.nullable(),
  name: text,
});
const message = z.object({
  id,
  roomId: id,
  senderId: id,
  senderName: text,
  body: z.string(),
  createdAt: timestamp,
});
const conversation = z.object({
  id,
  otherUserId: id,
  otherUserName: text,
  createdAt: timestamp,
});
const dm = z.object({
  id,
  conversationId: id,
  senderId: id,
  body: z.string(),
  createdAt: timestamp,
  readAt: timestamp.nullable(),
});
const adminRow = z.object({
  userId: id,
  name: text,
  reportCount: z.number().int().nonnegative(),
  blockCount: z.number().int().nonnegative(),
  status: text,
  lastReportedAt: timestamp.nullable(),
  topReasons: z.array(z.string()),
});
const record = z.record(z.unknown());
const studentModule = z
  .object({
    module: text,
    attempted_function: z.string().nullable().optional(),
    importable: z.boolean().optional(),
    called: z.boolean().optional(),
    status: text,
    error: z.string().nullable().optional(),
    available_functions: z.array(z.string()).optional(),
  })
  .passthrough();
const envelope = z
  .object({
    ok: z.boolean(),
    success: z.boolean().optional(),
    source: z.enum(["python", "student-module", "adapter-fallback"]),
    student_module: studentModule.nullable(),
    data: z.unknown(),
  })
  .passthrough()
  .refine((value) => Object.hasOwn(value, "data"));
const practice = z.object({ success: z.boolean(), status: text }).passthrough();
const matching = practice.extend({
  question_id: id,
  limit: z.number().int().min(1).max(20),
  matches: z.array(z.unknown()),
});
const failureMessage =
  "Student module returned an error. Check the named function.";

// Only diagnostics are changed. Successful student data is never synthesized.
export function projectStudentPayload(payload: unknown): unknown {
  if (Array.isArray(payload)) return payload.map(projectStudentPayload);
  if (payload === null || typeof payload !== "object") return payload;
  const value = record.parse(payload);
  if (value.status === "todo") return todo.parse(value);
  const failed =
    value.success === false ||
    value.ok === false ||
    (typeof value.error === "string" && value.error.length > 0);
  const projected: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (
      [
        "input",
        "detail",
        "stack",
        "traceback",
        "debug",
        "raw_result",
        "student_result",
      ].includes(key)
    )
      continue;
    if (key === "error")
      projected.error = entry ? "student_module_error" : entry;
    else if (key === "message")
      projected.message = failed
        ? failureMessage
        : z.string().max(1000).parse(entry);
    else if (["data", "matches", "result"].includes(key))
      projected[key] = entry;
    else projected[key] = projectStudentPayload(entry);
  }
  return projected;
}

export function projectPublicPayload(
  payload: unknown,
  path: string,
  method: string,
): unknown {
  if (path.startsWith("/api/chat/") || path.startsWith("/api/dms")) {
    if (
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      (payload as Record<string, unknown>).status === "todo"
    )
      return todo.parse(payload);
    if (path === "/api/chat/rooms") return room.array().parse(payload);
    if (path.startsWith("/api/chat/"))
      return (method === "GET" ? message.array() : message).parse(payload);
    if (path === "/api/dms") return conversation.array().parse(payload);
    if (path === "/api/dms/start") return conversation.parse(payload);
    return (method === "GET" ? dm.array() : dm).parse(payload);
  }
  if (
    [
      "/api/practice/",
      "/api/matches",
      "/api/analysis/",
      "/api/analytics/",
      "/api/python-reports/",
      "/api/scheduling/",
      "/api/admin/",
    ].some((prefix) => path.startsWith(prefix))
  ) {
    const value = record.parse(payload);
    if (
      path.startsWith("/api/matches") ||
      path.startsWith("/api/practice/matching/")
    )
      matching.parse(value);
    else if (path.startsWith("/api/practice/")) practice.parse(value);
    else envelope.parse(value);
    const projected = projectStudentPayload(value) as Record<string, unknown>;
    if (path === "/api/admin/flagged-users")
      projected.data = adminRow.array().parse(value.data);
    return projected;
  }
  // Non-learning endpoints still require their JSON container and identity fields.
  if (
    ["/api/districts", "/api/tags", "/api/requests", "/api/blocks"].includes(
      path,
    ) &&
    method === "GET"
  )
    return z.array(record).parse(payload);
  const value = record.parse(payload);
  if (path === "/api/auth/me") id.parse(value.id);
  if (path === "/api/auth/login" || path === "/api/auth/register")
    id.parse(record.parse(value.user).id);
  if (path === "/api/healthz") z.literal("ok").parse(value.status);
  return value;
}

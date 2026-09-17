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
// These check wire fields, not Python authorization or business decisions.
const integer = z.number().int();
const string = z.string();
const user = z.object({
  id,
  email: string,
  name: string,
  role: z.enum(["mentor", "mentee", "both"]),
  districtId: integer,
  districtName: string.nullable().optional(),
  bio: string.nullable().optional(),
  subjects: string.array(),
  isVerified: z.boolean(),
  createdAt: string,
});
const auth = z.object({ user, message: string });
const messageResponse = z.object({ message: string });
const health = z.object({ status: string });
const district = z.object({
  id: integer,
  name: string,
  county: string,
  type: z.enum(["high_school", "unified", "elementary", "other"]),
  memberCount: integer,
  openRequestCount: integer,
});
const tag = z.object({
  id: integer,
  name: string,
  color: string,
  requestCount: integer,
});
const mentorshipRequest = z.object({
  id: integer,
  authorId: integer,
  authorName: string,
  authorRole: z.enum(["mentor", "mentee"]),
  districtId: integer,
  districtName: string,
  title: string,
  description: string,
  tags: tag.array(),
  status: z.enum(["open", "matched", "closed"]),
  matchedUserId: integer.nullable().optional(),
  matchedUserName: string.nullable().optional(),
  createdAt: string,
  preferredTimes: string.array().optional(),
});
const blockedUser = z.object({
  id: integer,
  blockedUserId: integer,
  blockedUserName: string,
  createdAt: string,
});
const statsOverview = z.object({
  totalUsers: integer,
  totalMentors: integer,
  totalMentees: integer,
  totalDistricts: integer,
  openRequests: integer,
  successfulMatches: integer,
  topTags: tag.array(),
});
const districtStats = z.object({
  districtId: integer,
  districtName: string,
  memberCount: integer,
  mentorCount: integer,
  menteeCount: integer,
  openRequests: integer,
  matchedRequests: integer,
  topTags: tag.array(),
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
  return projectStudentPayloadWithFailure(payload, false);
}

function projectStudentPayloadWithFailure(
  payload: unknown,
  ancestorFailed: boolean,
): unknown {
  if (Array.isArray(payload))
    return payload.map((entry) =>
      projectStudentPayloadWithFailure(entry, ancestorFailed),
    );
  if (payload === null || typeof payload !== "object") return payload;
  const value = record.parse(payload);
  const failed =
    ancestorFailed ||
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
      projected[key] = failed
        ? projectStudentPayloadWithFailure(entry, true)
        : entry;
    else projected[key] = projectStudentPayloadWithFailure(entry, failed);
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
  if (path === "/api/auth/me") return user.parse(payload);
  if (path === "/api/auth/login" || path === "/api/auth/register")
    return auth.parse(payload);
  if (
    path === "/api/auth/logout" ||
    path === "/api/reports" ||
    (path === "/api/blocks" && method === "POST")
  )
    return messageResponse.parse(payload);
  if (path === "/api/districts") return district.array().parse(payload);
  if (path.startsWith("/api/districts/")) return district.parse(payload);
  if (path === "/api/tags") return tag.array().parse(payload);
  if (path.startsWith("/api/requests"))
    return (
      path === "/api/requests" && method === "GET"
        ? mentorshipRequest.array()
        : mentorshipRequest
    ).parse(payload);
  if (path === "/api/blocks") return blockedUser.array().parse(payload);
  if (path === "/api/stats/overview") return statsOverview.parse(payload);
  if (path.startsWith("/api/stats/district/"))
    return districtStats.parse(payload);
  if (path === "/api/healthz") return health.parse(payload);
  throw new TypeError("unsupported_public_response");
}

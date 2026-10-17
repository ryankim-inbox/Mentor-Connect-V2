import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { districtsTable } from "./districts";
import { tagsTable } from "./tags";

export const requestsTable = pgTable(
  "requests",
  {
    id: serial("id").primaryKey(),
    authorId: integer("author_id")
      .notNull()
      .references(() => usersTable.id),
    districtId: integer("district_id")
      .notNull()
      .references(() => districtsTable.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull().default("open"),
    matchedUserId: integer("matched_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    request: text("request"),
    preferredTimes: text("preferred_times").array().notNull().default([]),
    clientRequestId: uuid("client_request_id"),
    payloadHash: text("payload_hash"),
  },
  (table) => [
    unique("requests_author_client_request_key").on(table.authorId, table.clientRequestId),
    check("requests_payload_hash_check", sql`${table.payloadHash} IS NULL OR ${table.payloadHash} ~ '^[a-f0-9]{64}$'::text`),
    index("idx_requests_author_payload_created").on(table.authorId, table.payloadHash, table.createdAt.desc()),
    check("requests_role_check", sql`${table.role} IN ('mentee', 'mentor')`),
    check(
      "requests_status_check",
      sql`${table.status} IN ('open', 'matched', 'closed')`,
    ),
    index("idx_requests_status").on(table.status),
    index("idx_requests_district").on(table.districtId),
    index("idx_requests_author").on(table.authorId),
    index("idx_requests_preferred_times").using("gin", table.preferredTimes),
    index("idx_requests_open_matching_lookup")
      .on(table.districtId, table.role, table.createdAt.desc(), table.id)
      .where(sql`${table.status} = 'open'`),
  ],
);

export const requestSubmissionKeysTable = pgTable("request_submission_keys", {
  authorId: integer("author_id").notNull().references(() => usersTable.id),
  clientRequestId: uuid("client_request_id").notNull(),
  requestId: integer("request_id").notNull().references(() => requestsTable.id, { onDelete: "cascade" }),
  payloadHash: text("payload_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: "request_submission_keys_pkey", columns: [table.authorId, table.clientRequestId] }),
  check("request_submission_keys_payload_hash_check", sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'::text`),
  index("idx_request_submission_keys_request").on(table.requestId),
]);

export const requestTagsTable = pgTable(
  "request_tags",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => requestsTable.id, { onDelete: "cascade" }),
    tagId: integer("tag_id")
      .notNull()
      .references(() => tagsTable.id),
  },
  (table) => [
    unique("request_tags_request_id_tag_id_key").on(
      table.requestId,
      table.tagId,
    ),
    index("idx_request_tags_request").on(table.requestId),
    index("idx_request_tags_tag").on(table.tagId),
  ],
);

export const insertRequestSchema = createInsertSchema(requestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertRequest = z.infer<typeof insertRequestSchema>;
export type Request = typeof requestsTable.$inferSelect;

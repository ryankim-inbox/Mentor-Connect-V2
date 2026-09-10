import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
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
  },
  (table) => [
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

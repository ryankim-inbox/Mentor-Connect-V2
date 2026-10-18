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
import { requestsTable } from "./requests";

export const reportsTable = pgTable(
  "reports",
  {
    id: serial("id").primaryKey(),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => usersTable.id),
    reportedUserId: integer("reported_user_id")
      .notNull()
      .references(() => usersTable.id),
    reason: text("reason").notNull(),
    description: text("description"),
    status: text("status").notNull().default("open"),
    note: text("note"),
    reviewedBy: integer("reviewed_by").references(() => usersTable.id),
    reviewedAt: timestamp("reviewed_at", {withTimezone:true}),
    targetType: text("target_type").notNull().default("profile"),
    requestId: integer("request_id").references(() => requestsTable.id, { onDelete: "set null" }),
    requestTitle: text("request_title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("reports_target_type_check", sql`${table.targetType} IN ('profile', 'request')`),
    check("reports_target_context_check", sql`${table.targetType} = 'request'::text OR ${table.requestId} IS NULL AND ${table.requestTitle} IS NULL`),
    check("reports_request_title_check", sql`${table.requestTitle} IS NULL OR octet_length(${table.requestTitle}) <= 200`),
    index("idx_reports_target").on(table.reporterId, table.targetType, table.reportedUserId, table.requestId, table.status),
    check(
      "reports_no_self_check",
      sql`${table.reporterId} <> ${table.reportedUserId}`,
    ),
    check("reports_status_check", sql`${table.status} IN ('open', 'reviewing', 'resolved', 'dismissed')`),
    check("reports_note_check", sql`length(${table.note}) <= 2000`),
    index("idx_reports_status_id").on(table.status,table.id),
    index("idx_reports_reported").on(table.reportedUserId),
  ],
);

export const blocksTable = pgTable(
  "blocks",
  {
    id: serial("id").primaryKey(),
    blockerId: integer("blocker_id")
      .notNull()
      .references(() => usersTable.id),
    blockedUserId: integer("blocked_user_id")
      .notNull()
      .references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "blocks_no_self_check",
      sql`${table.blockerId} <> ${table.blockedUserId}`,
    ),
    unique("blocks_blocker_id_blocked_user_id_key").on(
      table.blockerId,
      table.blockedUserId,
    ),
    index("idx_blocks_blocker").on(table.blockerId),
  ],
);

export const insertReportSchema = createInsertSchema(reportsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertReport = z.infer<typeof insertReportSchema>;

export const insertBlockSchema = createInsertSchema(blocksTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBlock = z.infer<typeof insertBlockSchema>;

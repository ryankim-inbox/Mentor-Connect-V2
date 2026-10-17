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
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
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

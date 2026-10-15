import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { requestsTable } from "./requests";
import { usersTable } from "./users";

export const requestEventsTable = pgTable(
  "request_events",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    kind: text("kind").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    requestId: integer("request_id").references(() => requestsTable.id, {
      onDelete: "set null",
    }),
    mentorId: integer("mentor_id").references(() => usersTable.id, {
      onDelete: "set null",
    }),
    requestCreatedAt: timestamp("request_created_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "request_events_kind_check",
      sql`${table.kind} IN ('tracking_started', 'matched')`,
    ),
    check(
      "request_events_matched_created_at_check",
      sql`${table.kind} <> 'matched'::text OR ${table.requestCreatedAt} IS NOT NULL`,
    ),
    uniqueIndex("idx_request_events_tracking_started")
      .on(table.kind)
      .where(sql`${table.kind} = 'tracking_started'`),
    index("idx_request_events_kind_occurred_at_id").on(
      table.kind,
      table.occurredAt,
      table.id,
    ),
  ],
);

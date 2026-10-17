import { sql } from "drizzle-orm";
import {
  bigserial,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { requestsTable } from "./requests";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "bigint" }).primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    requestId: integer("request_id").references(() => requestsTable.id, {
      onDelete: "cascade",
    }),
    message: text("message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "notifications_kind_check",
      sql`${table.kind} IN ('request_match', 'request_match_summary')`,
    ),
    unique("notifications_user_id_request_id_kind_key").on(
      table.userId,
      table.requestId,
      table.kind,
    ),
    index("idx_notifications_user_created").on(
      table.userId,
      table.createdAt.desc(),
    ),
  ],
);

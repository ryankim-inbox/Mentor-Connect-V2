import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { requestsTable } from "./requests";
import { usersTable } from "./users";

export const requestApplicationsTable = pgTable(
  "request_applications",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => requestsTable.id, { onDelete: "cascade" }),
    applicantId: integer("applicant_id")
      .notNull()
      .references(() => usersTable.id),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "request_applications_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'rejected', 'cancelled')`,
    ),
    unique("request_applications_request_applicant_key").on(
      table.requestId,
      table.applicantId,
    ),
    index("idx_request_applications_request").on(table.requestId, table.id),
    index("idx_request_applications_applicant").on(table.applicantId, table.id),
  ],
);

export const requestCommentsTable = pgTable(
  "request_comments",
  {
    id: serial("id").primaryKey(),
    requestId: integer("request_id")
      .notNull()
      .references(() => requestsTable.id, { onDelete: "cascade" }),
    authorId: integer("author_id")
      .notNull()
      .references(() => usersTable.id),
    parentId: integer("parent_id"),
    updatedAt: timestamp("updated_at",{withTimezone:true}),
    deletedAt: timestamp("deleted_at",{withTimezone:true}),
    body: text("body").notNull(),
    clientCommentId: uuid("client_comment_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("request_comments_id_request_key").on(table.id, table.requestId),
    foreignKey({
      name: "request_comments_parent_fkey",
      columns: [table.parentId, table.requestId],
      foreignColumns: [table.id, table.requestId],
    }).onDelete("cascade"),
    unique("request_comments_operation_key").on(
      table.authorId,
      table.requestId,
      table.clientCommentId,
    ),
    index("idx_request_comments_request").on(table.requestId, table.id),
  ],
);

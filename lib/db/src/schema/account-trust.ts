import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const emailVerificationTokensTable = pgTable("email_verification_tokens", {
  userId: integer("user_id").primaryKey().references(() => usersTable.id, {onDelete:"cascade"}),
  email: text("email").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
  expiresAt: timestamp("expires_at",{withTimezone:true}).notNull(),
}, table => [check("email_verification_tokens_token_hash_check",sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'::text`)]);

export const emailVerificationRequestsTable = pgTable("email_verification_requests", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id,{onDelete:"cascade"}),
  kind: text("kind").notNull().default("request"),
  requestedAt: timestamp("requested_at",{withTimezone:true}).notNull().defaultNow(),
}, table => [
  check("email_verification_requests_kind_check",sql`${table.kind} IN ('request', 'confirm')`),
  index("idx_email_verification_requests_user").on(table.userId,table.kind,table.requestedAt),
]);

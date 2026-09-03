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
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { districtsTable } from "./districts";
import { usersTable } from "./users";

export const chatRoomsTable = pgTable(
  "chat_rooms",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    districtId: integer("district_id").references(() => districtsTable.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "chat_rooms_type_check",
      sql`${table.type} IN ('global', 'district')`,
    ),
    unique("chat_rooms_type_district_id_key").on(table.type, table.districtId),
    uniqueIndex("uq_chat_rooms_single_global")
      .on(table.type)
      .where(sql`${table.districtId} IS NULL`),
  ],
);

export const chatMessagesTable = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    roomId: integer("room_id")
      .notNull()
      .references(() => chatRoomsTable.id, { onDelete: "cascade" }),
    senderId: integer("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_chat_messages_room_created").on(table.roomId, table.createdAt),
  ],
);

export const dmConversationsTable = pgTable(
  "dm_conversations",
  {
    id: serial("id").primaryKey(),
    userAId: integer("user_a_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    userBId: integer("user_b_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check("dm_conversations_check", sql`${table.userAId} <> ${table.userBId}`),
    check(
      "dm_conversations_canonical_pair_check",
      sql`${table.userAId} < ${table.userBId}`,
    ),
    unique("dm_conversations_user_a_id_user_b_id_key").on(
      table.userAId,
      table.userBId,
    ),
    index("idx_dm_conversations_user_a").on(table.userAId),
    index("idx_dm_conversations_user_b").on(table.userBId),
  ],
);

export const dmMessagesTable = pgTable(
  "dm_messages",
  {
    id: serial("id").primaryKey(),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => dmConversationsTable.id, { onDelete: "cascade" }),
    senderId: integer("sender_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_dm_messages_conversation_created").on(
      table.conversationId,
      table.createdAt,
    ),
  ],
);

export const insertChatRoomSchema = createInsertSchema(chatRoomsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertChatRoom = z.infer<typeof insertChatRoomSchema>;
export type ChatRoom = typeof chatRoomsTable.$inferSelect;

export const insertChatMessageSchema = createInsertSchema(
  chatMessagesTable,
).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessagesTable.$inferSelect;

export const insertDmConversationSchema = createInsertSchema(
  dmConversationsTable,
).omit({ id: true, createdAt: true });
export type InsertDmConversation = z.infer<typeof insertDmConversationSchema>;
export type DmConversation = typeof dmConversationsTable.$inferSelect;

export const insertDmMessageSchema = createInsertSchema(dmMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertDmMessage = z.infer<typeof insertDmMessageSchema>;
export type DmMessage = typeof dmMessagesTable.$inferSelect;

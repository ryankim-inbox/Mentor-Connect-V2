import {
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

export const questionsTable = pgTable(
  "questions",
  {
    id: serial("id").primaryKey(),
    studentId: integer("student_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    topic: text("topic"),
    preferredTime: text("preferred_time"),
    preferredTimes: text("preferred_times").array().notNull().default([]),
    preferredLanguage: text("preferred_language"),
    preferredTeachingStyle: text("preferred_teaching_style"),
    message: text("message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_questions_student").on(table.studentId),
    index("idx_questions_preferred_times").using("gin", table.preferredTimes),
  ],
);

export const schedulesTable = pgTable(
  "schedules",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    slot: text("slot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    unique("schedules_user_id_slot_key").on(table.userId, table.slot),
    index("idx_schedules_slot").on(table.slot),
  ],
);

export const insertQuestionSchema = createInsertSchema(questionsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertQuestion = z.infer<typeof insertQuestionSchema>;
export type Question = typeof questionsTable.$inferSelect;

export const insertScheduleSchema = createInsertSchema(schedulesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertSchedule = z.infer<typeof insertScheduleSchema>;
export type Schedule = typeof schedulesTable.$inferSelect;

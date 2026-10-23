import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { districtsTable } from "./districts";

export const usersTable = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull().default("mentee"),
    districtId: integer("district_id")
      .notNull()
      .references(() => districtsTable.id),
    bio: text("bio"),
    subjects: text("subjects").array().notNull().default([]),
    isVerified: boolean("is_verified").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    location: text("location"),
    availableTimes: text("available_times").array(),
    languages: text("languages").array(),
    gradeLevel: text("grade_level"),
    teachingStyle: text("teaching_style"),
    emailVerifiedAt: timestamp("email_verified_at", {withTimezone:true}),
    isAdmin: boolean("is_admin").notNull().default(false),
    gender: text("gender"),
    dateOfBirth: date("date_of_birth"),
  },
  (table) => [
    check("users_gender_check", sql`${table.gender} IN ('female', 'male')`),
    check("users_email_ownership_check",sql`${table.isVerified} = (${table.emailVerifiedAt} IS NOT NULL)`),
    check(
      "users_role_check",
      sql`${table.role} IN ('mentee', 'mentor', 'both')`,
    ),
    index("idx_users_district").on(table.districtId),
    index("idx_users_role").on(table.role),
    index("idx_users_matching_lookup").on(
      table.districtId,
      table.role,
      table.isVerified,
      table.id,
    ),
  ],
);

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

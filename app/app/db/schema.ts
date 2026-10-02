import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Phase 0 interest list from the landing page. Personal data: see spec section 17.
export const interestSignups = sqliteTable("interest_signups", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  // City slug (tenant), see app/lib/cities.ts; "other" with cityOther set
  // when the city has no league yet.
  city: text("city").notNull().default("gyor"),
  cityOther: text("city_other"),
  mode: text("mode", { enum: ["pair", "solo"] }).notNull(),
  name1: text("name1").notNull(),
  email1: text("email1").notNull(),
  name2: text("name2"),
  email2: text("email2"),
  level: text("level").notNull(),
  note: text("note"),
  consentAt: integer("consent_at", { mode: "timestamp" }).notNull(),
  // Admin-only fields, see app/lib/signups-admin.ts.
  status: text("status", { enum: ["new", "contacted", "paired", "withdrawn"] })
    .notNull()
    .default("new"),
  adminNote: text("admin_note"),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  // Where the signup came from: the `?ref=` of the landing page link, e.g. a
  // club slug from that club's poster QR code (app/lib/clubs.ts).
  ref: text("ref"),
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

// Every email the app sends goes through this outbox, so sends can be retried
// and spread over days to stay under the provider's daily quota
// (app/lib/email/outbox.server.ts). Bodies are cleared once sent.
export const emailMessages = sqliteTable(
  "email_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kind: text("kind", { enum: ["signup_confirmation", "partner_notice", "broadcast"] }).notNull(),
    broadcastId: integer("broadcast_id").references(() => broadcasts.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    html: text("html"),
    text: text("text"),
    // JSON object of extra headers, e.g. List-Unsubscribe.
    headers: text("headers"),
    status: text("status", { enum: ["pending", "sending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerId: text("provider_id"),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("email_messages_status_idx").on(t.status, t.id),
    index("email_messages_sent_at_idx").on(t.sentAt),
    index("email_messages_to_idx").on(t.toEmail),
  ],
);

// Admin-written emails to a filtered audience (app/routes/admin.broadcasts.*).
export const broadcasts = sqliteTable("broadcasts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  // Human-readable audience, e.g. "Győr · Kezdő".
  audience: text("audience").notNull(),
  recipients: integer("recipients").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Addresses that unsubscribed from broadcasts. Kept after a signup is deleted,
// so a re-imported or re-entered address is still not mailed.
export const emailSuppressions = sqliteTable("email_suppressions", {
  email: text("email").primaryKey(),
  reason: text("reason", { enum: ["unsubscribed", "bounced", "complained"] }).notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// The city's padel clubs. Listed publicly on the landing page (with the booking
// link) only when `listed` is set, i.e. after the owner agreed to the poster and
// the listing (README decision log, 2026-10-02). The slug is the poster's
// `?ref=`. Later also the venue list for recording matches (spec: Venue).
export const clubs = sqliteTable("clubs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  city: text("city").notNull(),
  name: text("name").notNull(),
  address: text("address"),
  bookingUrl: text("booking_url"),
  listed: integer("listed", { mode: "boolean" }).notNull().default(false),
  // Admin-only, e.g. when and how the owner agreed.
  adminNote: text("admin_note"),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

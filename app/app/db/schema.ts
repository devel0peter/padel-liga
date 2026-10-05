import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  // Club slug where they play most (optional), or "other"; see clubs.ts.
  homeClub: text("home_club"),
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
    kind: text("kind", { enum: ["signup_confirmation", "partner_notice", "broadcast", "login_code"] }).notNull(),
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

// The city's padel clubs. Internal only: never listed publicly. Used to count
// signups per club, by poster (`?ref=<slug>`) and by where players say they
// play most. Later also the venue list for recording matches (spec: Venue).
export const clubs = sqliteTable("clubs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  city: text("city").notNull(),
  name: text("name").notNull(),
  adminNote: text("admin_note"),
  updatedAt: integer("updated_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Accounts (docs/admin-plan.md). No passwords: people log in with Google or a
// one-time code sent by email (app/lib/auth/). Personal data: spec section 17.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  // Lowercased; the same email is the same account whichever way they log in.
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  // "superadmin" (Főadmin) is set only by `npm run auth:superadmin -w app`;
  // no request handler writes this column. Organizer rights: league_admins.
  platformRole: text("platform_role", { enum: ["player", "superadmin"] }).notNull().default("player"),
  // Set on the first-login page; until then the account can't use the app.
  consentAt: integer("consent_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Only the SHA-256 of the cookie token is stored, so a database leak gives no
// working sessions.
export const sessions = sqliteTable(
  "sessions",
  {
    idHash: text("id_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const oauthAccounts = sqliteTable(
  "oauth_accounts",
  {
    provider: text("provider", { enum: ["google"] }).notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerUserId] }), index("oauth_accounts_user_idx").on(t.userId)],
);

// The latest login code per email (a new code replaces the old one). The
// email may not have an account yet. Rate limit: see app/lib/auth/rules.ts.
export const loginCodes = sqliteTable("login_codes", {
  email: text("email").primaryKey(),
  codeHash: text("code_hash").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  // Codes sent in the current hour-long window.
  windowStart: integer("window_start", { mode: "timestamp" }).notNull(),
  sentInWindow: integer("sent_in_window").notNull().default(1),
});

// Until registration opens, only these emails can create an account
// (`npm run auth:invite -w app`). Later also the interest-list invites (#20).
export const accountInvites = sqliteTable("account_invites", {
  email: text("email").primaryKey(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// A league in a city, e.g. "Padelpárbaj Győr" (spec section 4).
export const leagues = sqliteTable("leagues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  city: text("city").notNull(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Organizer ("Szervező") rights: one row per league and account.
export const leagueAdmins = sqliteTable(
  "league_admins",
  {
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    grantedBy: text("granted_by").references(() => users.id, { onDelete: "set null" }),
    grantedAt: integer("granted_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] }), index("league_admins_user_idx").on(t.userId)],
);

// Who changed roles and leagues, and when. actor_id is null for the CLI.
export const auditLog = sqliteTable("audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(), // e.g. "superadmin.grant", "league_admin.grant"
  target: text("target").notNull(), // e.g. an email or "league:gyor"
  detail: text("detail"),
  at: integer("at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Landing page views per Budapest day and source (app/lib/traffic.ts). Counts
// only: nothing about the visitor is stored.
export const landingViews = sqliteTable(
  "landing_views",
  {
    day: text("day").notNull(), // "2026-10-05"
    // `?ref=` or `?utm_source=`; "" is no source (a NULL can't be in the key).
    ref: text("ref").notNull().default(""),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.ref] })],
);

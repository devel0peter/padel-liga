import type { MatchOutcome, MatchScore } from "@padel-liga/rules";
import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// Phase 0 interest list from the landing page, retired (D123). Nothing writes
// or reads it; the cron deletes every row once (#334, D132,
// lib/interest-list-purge.server.ts). The table stays so the release is
// additive; a later cleanup can drop it.
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
  // A solo signup a Szervező paired with another solo (app/lib/solo-pairing.ts);
  // both rows point at each other.
  pairedWith: integer("paired_with"),
  // When this address got the registration invite (#20). Set on every signup
  // row of the address, so it is invited once (app/lib/email/audience.ts).
  invitedAt: integer("invited_at", { mode: "timestamp" }),
  // The same for email2, the partner of a pair signup (D26): invited_at
  // stays about email1, so each address is still invited once.
  invited2At: integer("invited2_at", { mode: "timestamp" }),
  // "Szívesen szerveznék ligát" on the other-city contact form: someone who
  // might organize a league where there is none yet.
  wantsToOrganize: integer("wants_to_organize", { mode: "boolean" }).notNull().default(false),
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
    kind: text("kind", {
      enum: [
        "signup_confirmation",
        "partner_notice",
        "broadcast",
        "login_code",
        "pair_intro",
        "registration_invite",
        "pair_invite",
        "pair_answer",
        "pair_dissolved",
        "pair_created",
        "season_entry_decision",
        "groups_published",
        "match_proposal",
        "match_agreed_time",
        "stuck_reminder",
        "match_digest",
        "match_tomorrow",
        "match_result",
        "strike_warning",
        "season_start",
      ],
    }).notNull(),
    broadcastId: integer("broadcast_id").references(() => broadcasts.id, { onDelete: "cascade" }),
    toEmail: text("to_email").notNull(),
    subject: text("subject").notNull(),
    html: text("html"),
    text: text("text"),
    // JSON object of extra headers, e.g. List-Unsubscribe.
    headers: text("headers"),
    // "held" (waiting for an Admin, #88) is gone since #112: migration 0024
    // turned the rows left into "pending".
    status: text("status", { enum: ["pending", "sending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    providerId: text("provider_id"),
    claimedAt: integer("claimed_at", { mode: "timestamp" }),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    // What Resend reported after sending (#242, D157): delivered, bounced
    // for good ("bounced") or for now ("soft_bounced"), or marked as spam.
    // Null: nothing reported (the relay reports nothing back).
    delivery: text("delivery", { enum: ["delivered", "bounced", "soft_bounced", "complained"] }),
    deliveryAt: integer("delivery_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("email_messages_status_idx").on(t.status, t.id),
    index("email_messages_sent_at_idx").on(t.sentAt),
    index("email_messages_to_idx").on(t.toEmail),
    // A Resend event names the email by its id (#242).
    index("email_messages_provider_idx").on(t.providerId),
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
  // False: hidden from new choices (signup home club, a match's venue), kept on
  // existing records. Deactivate instead of delete once a club is in use.
  active: integer("active", { mode: "boolean" }).notNull().default(true),
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
  // Profile picture URL from Google (refreshed at each Google login); none for
  // email-code accounts, which show initials.
  imageUrl: text("image_url"),
  // "superadmin" (Admin) is set only by `npm run auth:superadmin -w app`;
  // no request handler writes this column. Organizer rights: league_admins.
  platformRole: text("platform_role", { enum: ["player", "superadmin"] }).notNull().default("player"),
  // Self-assessed level (app/lib/interest.ts LEVELS keys), the base of the
  // starting Elo. Required on the first-login page; null only for accounts
  // from before it was asked (the home page prompts them).
  level: text("level", { enum: ["kezdo", "kozephalado", "halado", "versenyzo"] }),
  // The current Elo (#13, spec 11), unrounded; null until the first rated
  // match, while the level's starting value counts (packages/rules
  // currentElo). Written only by lib/elo.server.ts, which replays every
  // rated match.
  elo: real("elo"),
  // Hungarian phone number in E.164 ("+36301234567"), required on the profile
  // form since 2026-10-28 (older accounts may lack it). Personal data:
  // never on a public page; the current phase's opponents, the active
  // partner (D121) and the organizers (D126) see it.
  phone: text("phone"),
  // "male" or "female" (Férfi / Nő), as the player says on the first-login
  // or profile page (#133); never inferred. Null on older accounts until they
  // answer the one-time prompt. Personal data: never public or shown to other
  // players; for emails to a group of players (e.g. a women-only event).
  sex: text("sex", { enum: ["male", "female"] }),
  // Set on the first-login page; until then the account can't use the app.
  consentAt: integer("consent_at", { mode: "timestamp" }),
  // The latest login (a new session: Google or a login code), for the
  // Admin's user list. Sessions can't tell: logging out deletes them. Null
  // until the first login after it was added (backfilled from live sessions).
  lastLoginAt: integer("last_login_at", { mode: "timestamp" }),
  // Set when the account was deleted but kept anonymized for its history
  // (#152, lib/account-deletion.ts): name "Törölt játékos", no contact data,
  // no login. Hidden from every list and count; shown only in old pairs,
  // groups and matches.
  deletedAt: integer("deleted_at", { mode: "timestamp" }),
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
// (`npm run auth:invite -w app`), Szervező appointments, and the interest-list
// registration invites (#20, note INTEREST_INVITE_NOTE).
export const accountInvites = sqliteTable("account_invites", {
  email: text("email").primaryKey(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Cities (tenants), managed by the Admin at /admin/cities. Signups, clubs and
// leagues refer to a city by slug. `listed`: offered on the public signup
// form and the landing page (only cities with an organizer, spec section 4).
export const cities = sqliteTable("cities", {
  slug: text("slug").primaryKey(),
  name: text("name").notNull(),
  listed: integer("listed", { mode: "boolean" }).notNull().default(false),
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
  // When the league's Szervező or the Admin switched on the automatic
  // reminders for people stuck before entering (#155); null: off.
  remindersOnAt: integer("reminders_on_at", { mode: "timestamp" }),
  // How many round switches of the league's first season are fast
  // calibration switches (spec 10, #12): 2 pairs swap at a border of two
  // groups of 4. Default 1: the switch after phase 1 only.
  fastSwitches: integer("fast_switches").notNull().default(1),
  // How many pair entries the league's first season needs to start by itself
  // (D124, #335): three groups of four by default. Editable while that
  // season waits; later seasons keep their own calendar.
  minEntries: integer("min_entries").notNull().default(12),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// A run of a league: 4 phases of 3 weeks (spec section 4, issue #22). Days
// are Budapest calendar days ("2026-11-09"); instants are UTC.
export const seasons = sqliteTable(
  "seasons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    // Free text, e.g. "2026/27 tél".
    name: text("name").notNull(),
    // Registration: from 00:00 of its first day to 23:59 of its last, Budapest.
    registrationOpensAt: integer("registration_opens_at", { mode: "timestamp" }).notNull(),
    registrationClosesAt: integer("registration_closes_at", { mode: "timestamp" }).notNull(),
    // The Monday the organizer picked; phase 1 may start later if a break covers it.
    firstPhaseStart: text("first_phase_start").notNull(),
    // JSON array of { start, end } days, both included.
    breaks: text("breaks", { mode: "json" }).$type<{ start: string; end: string }[]>().notNull().default(sql`'[]'`),
    // A league's first season that starts once its entries reach the
    // league's min_entries (D124, #335). While it waits (start_fixed_at
    // null) it has no phases, first_phase_start is '' and
    // registration_closes_at equals registration_opens_at: seasons.server.ts
    // reads both as "not set". The entry that reaches the minimum sets all
    // three and writes the phases in the same batch.
    startsAtMinimum: integer("starts_at_minimum", { mode: "boolean" }).notNull().default(false),
    // When the entries reached the minimum, which fixed the start.
    startFixedAt: integer("start_fixed_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("seasons_league_idx").on(t.leagueId)],
);

// A season's phases, from packages/rules phaseCalendar; rewritten whenever the
// season is saved, while it can still be edited.
export const seasonPhases = sqliteTable(
  "season_phases",
  {
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    number: integer("number").notNull(), // 1–4
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(), // Monday 00:00 Budapest
    deadline: integer("deadline", { mode: "timestamp" }).notNull(), // Sunday 23:59 Budapest
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.number] })],
);

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

// A Szervező appointment for an email without an account yet. Turned into a
// league_admins row when that email's account is created (accounts.server.ts).
export const leagueAdminInvites = sqliteTable(
  "league_admin_invites",
  {
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.email] })],
);

// Every organizer and system change (#225), shown on Napló (#226). Written
// only through lib/audit.server.ts, in the same batch as the change.
// actor_id is null for the system (cron, the CLI). Since #225 targets and
// details name accounts by id ("user:<id>"), never by email; older rows may.
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(), // lib/audit.ts AUDIT_ACTIONS, e.g. "pair.dissolve"
    target: text("target").notNull(), // "<kind>:<id>", e.g. "pair:12", "user:<id>"
    detail: text("detail"),
    at: integer("at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    // The league the change belongs to, for Napló's league filter (#226).
    leagueId: integer("league_id").references(() => leagues.id, { onDelete: "set null" }),
  },
  (t) => [index("audit_log_at_idx").on(t.at), index("audit_log_league_idx").on(t.leagueId)],
);

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

// How many players had push on, once per Budapest day: the
// cron overwrites the day's row on every run, so a day shows its last count.
// Players: consented, not deleted, not Admin or Szervező. Push users: players
// with at least one subscribed device and the push channel on. Counts only.
export const pushStatsDaily = sqliteTable("push_stats_daily", {
  day: text("day").primaryKey(), // "2026-11-04"
  players: integer("players").notNull(),
  pushUsers: integer("push_users").notNull(),
  devices: integer("devices").notNull(),
});

// In-app notifications, newest first at /notifications; also sent as web push
// to the user's subscribed devices (app/lib/notifications.server.ts).
// Personal data: deleted with the account.
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "new_signup",
        "season_entry_decision",
        "groups_published",
        "pair_intro",
        "match_proposal",
        "match_agreed_time",
        "match_scheduled",
        "match_declined",
        "match_cancelled",
        "match_no_proposal",
        "match_week_end",
        "match_deadline_soon",
        "match_tomorrow",
        "match_result",
        "match_result_confirmed",
        "match_decided",
        "match_result_disputed",
        "result_disputed",
        "pair_withdrawn",
        "season_start",
        "strike",
        "substitute_requested",
        "substitute_approved",
        "substitute_rejected",
        "substitute_revoked",
        "no_show_reported",
        "no_show_confirmed",
        "no_show_rejected",
        "test",
      ],
    }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // A path on this site, opened through /notifications/<id>.
    url: text("url").notNull(),
    readAt: integer("read_at", { mode: "timestamp" }),
    // When the daily digest (#31) took this item, whether or not it went into
    // an email; each item is taken once.
    digestedAt: integer("digested_at", { mode: "timestamp" }),
    // Set while the push of an item the cron made waits to go out
    // (#183): the job pushes as many as fit its run and the next run goes on.
    // Null: pushed, nothing to push, or pushed at once (any other item).
    pushDueAt: integer("push_due_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.id), index("notifications_push_due_idx").on(t.pushDueAt)],
);

// One row per browser that allowed push (Push API subscription). Removed when
// the push service says it's gone, or when the user turns push off there.
export const pushSubscriptions = sqliteTable(
  "push_subscriptions",
  {
    endpoint: text("endpoint").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("push_subscriptions_user_idx").on(t.userId)],
);

// Notification kinds a user switched off on the profile page, and the
// channels (#115: "channel:email", "channel:push"; lib/notifications.ts). No
// row: on.
export const notificationOptOuts = sqliteTable(
  "notification_opt_outs",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind] })],
);

// Two players who play a league together (spec section 4). Formed by a pair
// link, on Párkeresők or by a Szervező on the Párok page (#97; from the
// interest signup, #89, until #333); a player is in at most one active pair
// per league. The inserts (pairs.server.ts) enforce it; the two unique
// indexes only catch the same player twice in the same column.
// Dissolved pairs stay as history, so later matches keep their pair.
export const pairs = sqliteTable(
  "pairs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    // For a pair from the interest signup (#89): the one who registered first,
    // and the one whose registration formed it. Before #97 also the inviter
    // and the invitee of a pair invite. For a manual pair: as the Szervező
    // picked them.
    playerA: text("player_a")
      .notNull()
      .references(() => users.id),
    playerB: text("player_b")
      .notNull()
      .references(() => users.id),
    inviteId: integer("invite_id")
      .unique()
      .references((): AnySQLiteColumn => pairInvites.id, { onDelete: "set null" }),
    status: text("status", { enum: ["active", "dissolved"] }).notNull().default("active"),
    // "signup": formed from the interest signup (#89), or by an invite before
    // #97; "manual": made by a Szervező on the Párok page (#97); "link": a
    // player accepted the other's pair link (2026-10-31); "search": made from
    // Regisztráltak on Párkeresők (D113, #297; "manual" before). A text
    // column without a CHECK: a new value needs no migration.
    source: text("source", { enum: ["signup", "manual", "link", "search"] }).notNull().default("signup"),
    dissolvedAt: integer("dissolved_at", { mode: "timestamp" }),
    dissolvedBy: text("dissolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("pairs_active_a_idx").on(t.leagueId, t.playerA).where(sql`status = 'active'`),
    uniqueIndex("pairs_active_b_idx").on(t.leagueId, t.playerB).where(sql`status = 'active'`),
  ],
);

// A player's invite to another to form a pair in a league, by email (#21).
// Unused since #97 (pair changes are an organizer task): kept so no live data
// is dropped; a later cleanup can drop it. Personal data: the invitee's email.
export const pairInvites = sqliteTable(
  "pair_invites",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // Lowercased; the invitee may not have an account yet.
    inviteeEmail: text("invitee_email").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    status: text("status", { enum: ["pending", "accepted", "declined", "cancelled"] })
      .notNull()
      .default("pending"),
    respondedAt: integer("responded_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("pair_invites_pending_idx").on(t.leagueId, t.inviterId).where(sql`status = 'pending'`),
    index("pair_invites_invitee_idx").on(t.inviteeEmail, t.status),
    index("pair_invites_inviter_idx").on(t.inviterId, t.createdAt),
  ],
);

// A player's own link to invite a partner (decision log, 2026-10-31):
// one per player and league, shown on /home and in Profil's Párod while
// they have no pair there. Whoever opens it, registers and taps "Elfogadom" becomes the
// partner, while both are without a pair in the league. The link carries the
// token; it is stored as is because the player shows it again on every visit.
export const pairLinks = sqliteTable(
  "pair_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("pair_links_owner_idx").on(t.leagueId, t.ownerId)],
);

// A league's players (D128, #331, replacing D93): the leagues an account
// joined. Being in a pair of the league counts too, with or without a row
// (league-members.server.ts). `source` says how they joined: "register" (the
// landing page's register button, written at login, before the first-login
// page is done), "link" (accepted a pair link), "chosen" (the Kezdőlap card),
// "pair" (a pair of the league was formed with them), "entry" and "carried"
// (the release's backfill: an entry of the league, or a D93 player). A text
// column without a CHECK: a new value needs no migration.
export const leagueMembers = sqliteTable(
  "league_members",
  {
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: text("source", { enum: ["register", "link", "chosen", "pair", "entry", "carried"] }).notNull(),
    joinedAt: integer("joined_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] }), index("league_members_user_idx").on(t.userId)],
);

// "Párt keresek" (D59): a registered player without a pair says, per league,
// whether the organizer should find them a partner; Párkeresők lists them.
// No row: off (D128, #333; before, on for a waiting solo signup, whose
// default the release stored as a row). A row stays when they get a pair; it
// only counts while they have none.
export const partnerSearches = sqliteTable(
  "partner_searches",
  {
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seeking: integer("seeking", { mode: "boolean" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.leagueId, t.userId] })],
);

// A pair's entry to a season ("Nevezünk", #23, spec section 4). Either player
// applies while the season is open (registration opens → the last phase
// starts); a Szervező approves or rejects, and can change the decision later.
// One row per season and pair: a rejected pair can't apply again. Dissolving
// the pair withdraws its entries for seasons not started yet (D19).
export const seasonEntries = sqliteTable(
  "season_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    pairId: integer("pair_id")
      .notNull()
      .references(() => pairs.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "approved", "rejected", "withdrawn"] })
      .notNull()
      .default("pending"),
    // The Szervező's optional note, sent to both players with the decision.
    note: text("note"),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    // The phase the pair starts in, set on approval: 1 before the season
    // starts, else the next phase; null when approved during the last phase
    // (it moves into the next season).
    joinsPhase: integer("joins_phase"),
    updatedAt: integer("updated_at", { mode: "timestamp" }),
    // When the pair applied.
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("season_entries_season_pair_idx").on(t.seasonId, t.pairId),
    index("season_entries_pair_idx").on(t.pairId),
  ],
);

// The automatic reminders already sent (#155, reminders.ts): one row per
// reminder, so none goes out twice. `key` is "A:<email>", "B:<user id>",
// "C:<user id>" or "D:<pair id>:<season id>". Personal data: an A key held
// a list address; the interest list's deletion removed them (#334).
export const stuckReminders = sqliteTable(
  "stuck_reminders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    key: text("key").notNull().unique(),
    situation: text("situation", { enum: ["A", "B", "C", "D"] }).notNull(),
    leagueId: integer("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    seasonId: integer("season_id").references(() => seasons.id, { onDelete: "set null" }),
    // How many emails it queued (D: up to both players).
    recipients: integer("recipients").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("stuck_reminders_league_idx").on(t.leagueId, t.situation)],
);

// Who got a stuck reminder in which season, any situation (#191): at most
// one each per league season. Written in the same batch as stuck_reminders
// and the emails; the key makes an overlapping run fail as a whole.
export const stuckReminderPeople = sqliteTable(
  "stuck_reminder_people",
  {
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    // Lowercase.
    email: text("email").notNull(),
    situation: text("situation", { enum: ["A", "B", "C", "D"] }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.email] })],
);

// A phase's groups (#24, D21), 1. csoport the strongest. Until published_at
// is set they are the Szervező's draft: regenerated or adjusted at will, and
// stored so moves persist. Publishing creates the matches and the emails;
// after that the groups are locked.
export const groups = sqliteTable(
  "groups",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    phase: integer("phase").notNull(), // 1–4
    number: integer("number").notNull(), // 1 = strongest
    // Bumped by every move into or out of the group, so publishing can tell
    // that the draft it checked is still the one it locks.
    revision: integer("revision").notNull().default(0),
    // A round switch draft (#35): the draft the system computed, before the
    // organizer's moves, as sorted pair ids per group ("1,2,5,6|3,4,7,8"),
    // so publishing can tell that the ending phase's results or pairs have
    // changed since. Null for phase 1.
    basis: text("basis"),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [uniqueIndex("groups_season_phase_number_idx").on(t.seasonId, t.phase, t.number)],
);

// The pairs of a group, with their seed (1 = strongest in the group), which
// sets the fixture order (spec section 5).
export const groupPairs = sqliteTable(
  "group_pairs",
  {
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    pairId: integer("pair_id")
      .notNull()
      .references(() => pairs.id, { onDelete: "cascade" }),
    seed: integer("seed").notNull(),
    // Withdrawn mid-phase by the organizer (#34, D87): the pair and every
    // match it has in this group leave the table, played or not, and the
    // group goes on without it (withdrawPairMidPhase, season-entries.server.ts).
    // The reason is for the organizer and the pair itself, never shown to
    // other players; anonymizing an account clears it.
    withdrawnAt: integer("withdrawn_at", { mode: "timestamp" }),
    withdrawalReason: text("withdrawal_reason"),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.pairId] }), index("group_pairs_pair_idx").on(t.pairId)],
);

// A match between two pairs of a group (spec section 4), created when the
// groups are published (D21). Its log (match_events) is the source of truth;
// status, scheduled_at and club_id are kept in step with it for lists.
export const matches = sqliteTable(
  "matches",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    groupId: integer("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    pairA: integer("pair_a")
      .notNull()
      .references(() => pairs.id, { onDelete: "cascade" }),
    pairB: integer("pair_b")
      .notNull()
      .references(() => pairs.id, { onDelete: "cascade" }),
    week: integer("week").notNull(), // the scheduled week, 1–3
    // The end of the phase: its last Sunday 23:59 Budapest (spec section 5).
    deadline: integer("deadline", { mode: "timestamp" }).notNull(),
    // "open": not scheduled yet (a proposal or agreed time may be waiting:
    // packages/rules schedulingState); "scheduled": a slot was accepted or an
    // agreed time confirmed (#26); "result_pending": a result waits for the
    // other pair, "disputed": the organizer decides, "final": the outcome
    // counts (#28, #29; packages/rules resultState).
    status: text("status", { enum: ["open", "scheduled", "result_pending", "disputed", "final"] }).notNull().default("open"),
    // The agreed start and the venue offered with it, once scheduled.
    scheduledAt: integer("scheduled_at", { mode: "timestamp" }),
    clubId: integer("club_id").references(() => clubs.id),
    // Bumped by every step in the log, so two answers at the same moment
    // can't both win (matches.server.ts).
    revision: integer("revision").notNull().default(0),
    // The outcome that counts, once final (#28, #29); sides as pair_a/pair_b.
    outcome: text("outcome", { mode: "json" }).$type<MatchOutcome>(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    // Two pairs meet once per group (spec section 5): a second publish of
    // the same groups fails here instead of doubling the matches.
    uniqueIndex("matches_group_pairs_idx").on(t.groupId, t.pairA, t.pairB),
    index("matches_group_idx").on(t.groupId),
    index("matches_pair_a_idx").on(t.pairA),
    index("matches_pair_b_idx").on(t.pairB),
  ],
);

// A match's log (spec 6.5, #26): every scheduling step with its pair, player
// and time, kept for the walkover decision at the deadline (spec 8) and shown
// on the match page. Append-only. Later steps (cancel and venue #27, results
// #28, reminders #31, the organizer's overview #158) add their own kinds.
// Personal data: who acted (user_id; set null when the account is deleted).
export const matchEvents = sqliteTable(
  "match_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // The acting pair, one of the match's two; for "agreed_auto_fixed" the
    // pair that didn't answer.
    pairId: integer("pair_id")
      .notNull()
      .references(() => pairs.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind", {
      enum: [
        "proposal",
        "counter_proposal",
        "accepted",
        "agreed_time",
        "agreed_confirmed",
        "agreed_declined",
        "venue",
        "cancelled",
        // D148: a tap on "SMS mindenkinek" / "E-mail mindenkinek", and the
        // system's line for an agreed time fixed by itself (user_id null).
        "contacted",
        "agreed_auto_fixed",
        "result_recorded",
        "result_confirmed",
        "result_disputed",
      ],
    }).notNull(),
    // A proposal's availability ranges (D144): JSON array of [start, end] in
    // UTC seconds. Proposals before D144 stored bare starts (a number each),
    // read as ranges one match long: always read with storedRanges().
    slots: text("slots", { mode: "json" }).$type<(number | [number, number])[]>(),
    // The accepted slot, or the agreed time; for "cancelled" the slot given up.
    slot: integer("slot", { mode: "timestamp" }),
    // The venue offered with a proposal or an agreed time (optional), or
    // recorded after booking ("venue", #27).
    clubId: integer("club_id").references(() => clubs.id),
    // "venue": the court, free text (optional, #27).
    court: text("court"),
    // A recorded result, or the disputing pair's version (#28); sides as
    // pair_a/pair_b.
    score: text("score", { mode: "json" }).$type<MatchScore>(),
    // The disputing pair's note to the organizer (#28, optional); for
    // "contacted" the channel tapped, "sms" or "email" (D148).
    note: text("note"),
    at: integer("at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("match_events_match_idx").on(t.matchId, t.id)],
);

// A match's outcome set from outside the two pairs (#28, #29): the 48-hour
// auto-accept of a waiting result (user_id null), or the organizer's decision
// on a dispute or override of any match, with a required reason. Append-only;
// the latest row counts (packages/rules resultState). Shown in the match log.
// Kept apart from match_events, whose pair_id names the acting pair.
// Personal data: who decided (user_id; set null when the account is deleted).
export const matchDecisions = sqliteTable(
  "match_decisions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // "deadline": the cron resolved an unplayed match after the deadline
    // (#11, D103; user_id null).
    kind: text("kind", { enum: ["auto_accepted", "deadline", "organizer"] }).notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    // Sides as pair_a/pair_b.
    outcome: text("outcome", { mode: "json" }).$type<MatchOutcome>().notNull(),
    reason: text("reason"),
    at: integer("at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("match_decisions_match_idx").on(t.matchId, t.id)],
);

// The reminders that went out for a match (#31), so each goes once: the
// digest reminders once per match, "holnap meccs" once per scheduled slot
// (`slot`, seconds; 0 for the others). The cron claims a row before
// it notifies the four players.
// Work of the cron that is done for a period (#183): "morning:<day>"
// once the day's digest reminders and digest are made. A morning run that
// couldn't finish within its limits leaves no row, and the next morning run
// goes on.
export const jobRuns = sqliteTable("job_runs", {
  key: text("key").primaryKey(),
  doneAt: integer("done_at", { mode: "timestamp" }).notNull(),
});

// Strikes ("fekete pont", spec 8, #294, D103): one row per player and
// strike, given by the deadline resolution (#11) or a confirmed no-show
// (#33). They count per player per season (packages/rules strikes.ts), so a
// partner change keeps them and a new season starts from zero. The organizer
// can cancel one with a reason; the row stays, the count leaves it out.
// Personal data: the reason may name an illness; anonymizing the player's
// account clears it.
export const strikes = sqliteTable(
  "strikes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The pair the player played in when it was given.
    pairId: integer("pair_id").references(() => pairs.id, { onDelete: "set null" }),
    matchId: integer("match_id").references(() => matches.id, { onDelete: "set null" }),
    source: text("source", { enum: ["deadline", "no_show"] }).notNull(),
    at: integer("at", { mode: "timestamp" }).notNull(),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    cancelledBy: text("cancelled_by").references(() => users.id, { onDelete: "set null" }),
    cancelReason: text("cancel_reason"),
  },
  (t) => [
    index("strikes_season_user_idx").on(t.seasonId, t.userId),
    // One strike per player per match and source: a re-run gives none twice.
    uniqueIndex("strikes_match_user_source_idx").on(t.matchId, t.userId, t.source),
  ],
);

export const matchReminders = sqliteTable(
  "match_reminders",
  {
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["match_no_proposal", "match_week_end", "match_deadline_soon", "match_tomorrow"] }).notNull(),
    slot: integer("slot").notNull().default(0),
    sentAt: integer("sent_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.kind, t.slot] })],
);

// Every player's Elo change in every rated match (#13, spec 11): a played
// match that is final. Rewritten by lib/elo.server.ts from a replay of all
// rated matches in the order they first became final, so an organizer's
// later ruling changes the history as if it had been there from the start.
// `at`: when the match first became final (the replay order). For the
// profile's history (#36).
export const eloChanges = sqliteTable(
  "elo_changes",
  {
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ratingBefore: real("rating_before").notNull(),
    ratingAfter: real("rating_after").notNull(),
    delta: real("delta").notNull(),
    // The side's K: the average of its two players' K (D104).
    k: real("k").notNull(),
    at: integer("at", { mode: "timestamp" }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.matchId, t.userId] }), index("elo_changes_user_idx").on(t.userId, t.at)],
);

// A substitute for an absent player in one match (#37, spec 4, D109). A
// player of the pair asks before the match starts, the league's organizer
// approves or rejects it (optional reason) and may revoke an approval until
// the start. Only an approved row changes who played: Elo (elo.server.ts)
// rates the substitute instead of the absent player. One live row
// (requested or approved) per absent player per match.
// Personal data: who asked and who decided (set null when the account is
// deleted); the reason is for the pair and the organizer only.
export const matchSubstitutes = sqliteTable(
  "match_substitutes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // The asking pair, one of the match's two.
    pairId: integer("pair_id")
      .notNull()
      .references(() => pairs.id, { onDelete: "cascade" }),
    // Restrict: who played stays resolvable (Elo). An account named here in
    // an approved request counts as history and is anonymized, never removed
    // (account-deletion.server.ts, D60); a removal deletes its other requests.
    absentId: text("absent_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    substituteId: text("substitute_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["requested", "approved", "rejected", "withdrawn", "revoked"] }).notNull().default("requested"),
    requestedBy: text("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: integer("requested_at", { mode: "timestamp" }).notNull(),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    // The organizer's optional reason for a rejection or a revocation.
    reason: text("reason"),
  },
  (t) => [
    uniqueIndex("match_substitutes_live_idx")
      .on(t.matchId, t.absentId)
      .where(sql`${t.status} in ('requested', 'approved')`),
    // A person is named once per match.
    uniqueIndex("match_substitutes_live_substitute_idx")
      .on(t.matchId, t.substituteId)
      .where(sql`${t.status} in ('requested', 'approved')`),
    index("match_substitutes_match_idx").on(t.matchId),
    index("match_substitutes_status_idx").on(t.status),
  ],
);

// No-show reports (#33, spec 8, D108): a player of the pair that showed up
// at an accepted slot reports that the other didn't; the league's organizer
// confirms (a walkover in match_decisions, a strike in strikes) or rejects
// it. One waiting report per match; the reporter can withdraw it before a
// decision. The deadline resolution leaves a match with a waiting report to
// the organizer.
export const noShowReports = sqliteTable(
  "no_show_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    matchId: integer("match_id")
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    // The pair that showed up and reports it, one of the match's two.
    pairId: integer("pair_id")
      .notNull()
      .references(() => pairs.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["open", "withdrawn", "confirmed", "rejected"] }).notNull().default("open"),
    reportedBy: text("reported_by").references(() => users.id, { onDelete: "set null" }),
    reportedAt: integer("reported_at", { mode: "timestamp" }).notNull(),
    decidedBy: text("decided_by").references(() => users.id, { onDelete: "set null" }),
    decidedAt: integer("decided_at", { mode: "timestamp" }),
    // The organizer's optional reason, shown to both pairs on the match page.
    reason: text("reason"),
  },
  (t) => [
    uniqueIndex("no_show_reports_open_idx")
      .on(t.matchId)
      .where(sql`${t.status} = 'open'`),
    index("no_show_reports_match_idx").on(t.matchId),
    index("no_show_reports_status_idx").on(t.status),
  ],
);

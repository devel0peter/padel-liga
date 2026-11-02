import { sql } from "drizzle-orm";
import { type AnySQLiteColumn, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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
        "season_entry_decision",
        "groups_published",
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
  // Hungarian phone number in E.164 ("+36301234567"), required on the profile
  // form since 2026-10-28 (older accounts may lack it). Personal data:
  // never on a public page; only the current phase's opponents will see it.
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
    kind: text("kind", { enum: ["new_signup", "season_entry_decision", "groups_published", "pair_intro", "test"] }).notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    // A path on this site, opened through /notifications/<id>.
    url: text("url").notNull(),
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.id)],
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

// Two players who play a league together (spec section 4). Formed from the
// interest signup (#89) or by a Szervező on the Párok page (#97); a player is
// in at most one active pair per league. The inserts (signup-partners.server.ts,
// pairs.server.ts) enforce it; the two unique indexes only catch the same
// player twice in the same column.
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
    // player accepted the other's pair link (2026-10-31).
    source: text("source", { enum: ["signup", "manual", "link"] }).notNull().default("signup"),
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

// A player's own link to invite a partner (README decision log, 2026-10-31):
// one per player and league, shown on /home and /pair while they have no
// pair there. Whoever opens it, registers and taps "Elfogadom" becomes the
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

// "Párt keresek" (D59): a registered player without a pair says, per league,
// whether the organizer should find them a partner; Párkeresők lists them.
// No row: the default, which is on for someone whose solo signup is still
// waiting and off for everyone else (partner-search.ts). A row stays when they
// get a pair; it only counts while they have none.
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
  },
  (t) => [primaryKey({ columns: [t.groupId, t.pairId] }), index("group_pairs_pair_idx").on(t.pairId)],
);

// A match between two pairs of a group (spec section 4), created when the
// groups are published. Minimal for now (D21): scheduling, results and the
// other statuses come with milestone 2.
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
    status: text("status", { enum: ["open"] }).notNull().default("open"),
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

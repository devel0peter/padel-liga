import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

// Paths are English; everything on the page is Hungarian (CLAUDE.md).
export default [
  index("routes/home.tsx"),
  route("rules", "routes/rules.tsx"),
  route("privacy", "routes/privacy.tsx"),
  // Visszajelzés: public, for visitors too (#240, spec 19).
  route("feedback", "routes/feedback.tsx"),
  route("unsubscribe", "routes/unsubscribe.tsx"),
  route("api/landing", "routes/landing-beacon.ts"),
  route("webhooks/resend", "routes/webhooks.resend.ts"),
  route("login", "routes/login.tsx"),
  route("register", "routes/register.tsx"),
  route("welcome", "routes/welcome.tsx"),
  route("logout", "routes/logout.ts"),
  route("auth/google", "routes/auth.google.ts"),
  route("auth/google/callback", "routes/auth.google.callback.ts"),
  route("api/push", "routes/api.push.ts"),
  route("pair/join/:token", "routes/pair-join.tsx"),
  route("notifications/:id", "routes/notification-open.ts"),
  route("health", "routes/health.ts"),
  // The old Párom address: leads to Profil's Párod section (D141).
  route("pair", "routes/pair.ts"),
  // Every page for a logged-in user: one sidebar layout (app.tsx). The admin
  // section inside it has its own guard (admin.tsx).
  layout("routes/app.tsx", [
    route("home", "routes/app.home.tsx"),
    route("profile", "routes/profile.tsx"),
    route("notifications", "routes/notifications.tsx"),
    route("matches/:id", "routes/match.tsx"),
    // The league page ("Tabella"): for logged-in players only (D134).
    route("league/:league", "routes/league.tsx"),
    // The Ranglista: players and pairs by Élő-pont (D137).
    route("league/:league/rankings", "routes/rankings.tsx"),
    // Pair and player profiles: for logged-in members only (D112).
    route("players/:id", "routes/player-profile.tsx"),
    route("pairs/:id", "routes/pair-profile.tsx"),
    layout("routes/admin.tsx", [
      route("admin", "routes/admin._index.tsx"),
      route("admin/signups", "routes/admin.signups.tsx"),
      route("admin/broadcasts", "routes/admin.broadcasts.tsx"),
      route("admin/broadcasts/new", "routes/admin.broadcast-new.tsx"),
      route("admin/outbox", "routes/admin.outbox.tsx"),
      route("admin/clubs", "routes/admin.clubs.tsx"),
      route("admin/traffic", "routes/admin.traffic.tsx"),
      route("admin/leagues", "routes/admin.leagues.tsx"),
      route("admin/cities", "routes/admin.cities.tsx"),
      route("admin/users", "routes/admin.users.tsx"),
      route("admin/users/:id", "routes/admin.user.tsx"),
      route("admin/log", "routes/admin.log.tsx"),
      route("admin/leagues/:league", "routes/admin.league.tsx"),
      route("admin/leagues/:league/seasons", "routes/admin.league-seasons.tsx"),
      route("admin/leagues/:league/seasons/:season/entries", "routes/admin.season-entries.tsx"),
      route("admin/leagues/:league/seasons/:season/groups", "routes/admin.season-groups.tsx"),
      route("admin/leagues/:league/pairs", "routes/admin.league-pairs.tsx"),
      route("admin/leagues/:league/players", "routes/admin.league-players.tsx"),
      // Párkeresők until #301: redirects to Játékosok.
      route("admin/leagues/:league/solos", "routes/admin.league-solos.tsx"),
      route("admin/leagues/:league/reminders", "routes/admin.league-reminders.tsx"),
      route("admin/leagues/:league/clubs", "routes/admin.league-clubs.tsx"),
      route("admin/leagues/:league/matches", "routes/admin.league-matches.tsx"),
      route("admin/leagues/:league/matches/:id", "routes/admin.league-match.tsx"),
      route("admin/leagues/:league/disputes", "routes/admin.league-disputes.tsx"),
      route("admin/leagues/:league/substitutes", "routes/admin.league-substitutes.tsx"),
      route("admin/leagues/:league/matches/:id/decide", "routes/admin.match-decide.tsx"),
    ]),
  ]),
  route("admin/poster", "routes/admin.poster.tsx"),
  route("admin/export.csv", "routes/admin.export.ts"),
  route("matches/:id/calendar.ics", "routes/match-calendar.ts"),
  // A tap on Írj mindenkinek's SMS or e-mail button (D148).
  route("matches/:id/contact", "routes/match-contact.ts"),

  // Hungarian paths from before 2026-10-04, still in sent emails and shared
  // links. Unsubscribe links are POSTed by mail clients (RFC 8058), which
  // don't follow redirects, so that one keeps serving the page itself.
  route("leiratkozas", "routes/unsubscribe.tsx", { id: "unsubscribe-legacy" }),
  route("szabalyzat", "routes/legacy-redirect.ts", { id: "legacy-rules" }),
  route("adatkezeles", "routes/legacy-redirect.ts", { id: "legacy-privacy" }),
] satisfies RouteConfig;

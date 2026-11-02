import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

// Paths are English; everything on the page is Hungarian (CLAUDE.md).
export default [
  index("routes/home.tsx"),
  route("rules", "routes/rules.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("league/:league", "routes/league.tsx"),
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
  // Every page for a logged-in user: one sidebar layout (app.tsx). The admin
  // section inside it has its own guard (admin.tsx).
  layout("routes/app.tsx", [
    route("home", "routes/app.home.tsx"),
    route("pair", "routes/pair.tsx"),
    route("profile", "routes/profile.tsx"),
    route("notifications", "routes/notifications.tsx"),
    route("matches/:id", "routes/match.tsx"),
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
      route("admin/leagues/:league", "routes/admin.league.tsx"),
      route("admin/leagues/:league/seasons", "routes/admin.league-seasons.tsx"),
      route("admin/leagues/:league/seasons/:season/entries", "routes/admin.season-entries.tsx"),
      route("admin/leagues/:league/seasons/:season/groups", "routes/admin.season-groups.tsx"),
      route("admin/leagues/:league/pairs", "routes/admin.league-pairs.tsx"),
      route("admin/leagues/:league/solos", "routes/admin.league-solos.tsx"),
      route("admin/leagues/:league/clubs", "routes/admin.league-clubs.tsx"),
    ]),
  ]),
  route("admin/poster", "routes/admin.poster.tsx"),
  route("admin/export.csv", "routes/admin.export.ts"),

  // Hungarian paths from before 2026-10-04, still in sent emails and shared
  // links. Unsubscribe links are POSTed by mail clients (RFC 8058), which
  // don't follow redirects, so that one keeps serving the page itself.
  route("leiratkozas", "routes/unsubscribe.tsx", { id: "unsubscribe-legacy" }),
  route("szabalyzat", "routes/legacy-redirect.ts", { id: "legacy-rules" }),
  route("adatkezeles", "routes/legacy-redirect.ts", { id: "legacy-privacy" }),
] satisfies RouteConfig;

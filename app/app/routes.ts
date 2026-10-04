import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

// Paths are English; everything on the page is Hungarian (CLAUDE.md).
export default [
  index("routes/home.tsx"),
  route("rules", "routes/rules.tsx"),
  route("privacy", "routes/privacy.tsx"),
  route("unsubscribe", "routes/unsubscribe.tsx"),
  route("api/landing", "routes/landing-beacon.ts"),
  route("login", "routes/login.tsx"),
  route("welcome", "routes/welcome.tsx"),
  route("account", "routes/account.tsx"),
  route("logout", "routes/logout.ts"),
  route("auth/google", "routes/auth.google.ts"),
  route("auth/google/callback", "routes/auth.google.callback.ts"),
  layout("routes/admin.tsx", [
    route("admin", "routes/admin.signups.tsx"),
    route("admin/broadcasts", "routes/admin.broadcasts.tsx"),
    route("admin/broadcasts/new", "routes/admin.broadcast-new.tsx"),
    route("admin/clubs", "routes/admin.clubs.tsx"),
    route("admin/traffic", "routes/admin.traffic.tsx"),
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

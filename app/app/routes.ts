import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("szabalyzat", "routes/rules.tsx"),
  route("adatkezeles", "routes/privacy.tsx"),
  route("leiratkozas", "routes/unsubscribe.tsx"),
  route("api/landing", "routes/landing-beacon.ts"),
  layout("routes/admin.tsx", [
    route("admin", "routes/admin.signups.tsx"),
    route("admin/levelek", "routes/admin.broadcasts.tsx"),
    route("admin/levelek/uj", "routes/admin.broadcast-new.tsx"),
    route("admin/klubok", "routes/admin.clubs.tsx"),
    route("admin/forgalom", "routes/admin.traffic.tsx"),
  ]),
  route("admin/plakat", "routes/admin.poster.tsx"),
  route("admin/export.csv", "routes/admin.export.ts"),
] satisfies RouteConfig;

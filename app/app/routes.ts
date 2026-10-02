import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("szabalyzat", "routes/rules.tsx"),
  route("adatkezeles", "routes/privacy.tsx"),
  layout("routes/admin.tsx", [route("admin", "routes/admin.signups.tsx")]),
  route("admin/export.csv", "routes/admin.export.ts"),
] satisfies RouteConfig;

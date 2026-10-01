import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("szabalyzat", "routes/rules.tsx"),
  route("adatkezeles", "routes/privacy.tsx"),
] satisfies RouteConfig;

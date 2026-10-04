import { redirect } from "react-router";

import type { Route } from "./+types/legacy-redirect";

// Old Hungarian paths (app/routes.ts) to their English ones, query kept.
const MOVED: Record<string, string> = {
  "/szabalyzat": "/rules",
  "/adatkezeles": "/privacy",
};

export function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  return redirect(`${MOVED[path] ?? "/"}${url.search}`, 301);
}

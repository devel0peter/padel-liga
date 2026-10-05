import { isRouteErrorResponse, Outlet } from "react-router";

import type { Route } from "./+types/admin";
import { Forbidden } from "~/components/forbidden";
import { requirePermission } from "~/lib/auth/admin.server";
import { SITE_NAME } from "~/lib/site";

// The admin section of the app shell (app.tsx). No UI of its own: it only
// guards. Every admin loader and action also checks its own permission.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Admin – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

// Runs before every admin loader and action, including direct data requests,
// so no admin page is reachable without a session and an admin role.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }) => {
    await requirePermission(request, { kind: "admin.enter" });
  },
];

export default function AdminSection() {
  return <Outlet />;
}

// 403 from a child loader or action; a 403 from the middleware reaches the
// root error boundary instead (it runs before any loader).
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 403) return <Forbidden />;
  throw error;
}

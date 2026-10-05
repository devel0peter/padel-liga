import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
  useNavigation,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { Forbidden } from "./components/forbidden";
import { getUser } from "./lib/auth/session.server";
import { webAnalyticsToken } from "./lib/web-analytics.server";

export async function loader({ request }: Route.LoaderArgs) {
  return {
    webAnalyticsToken: webAnalyticsToken(),
    // The public header shows "Saját oldalam" instead of "Jelentkezem".
    signedIn: !!(await getUser(request)),
  };
}

// Cloudflare Web Analytics: cookieless, so no consent banner (README decision
// log). Public pages only; the admin isn't counted.
function WebAnalytics() {
  const token = useRouteLoaderData<typeof loader>("root")?.webAnalyticsToken;
  const { pathname } = useLocation();
  if (!token || pathname.startsWith("/admin")) return null;
  return (
    <script
      defer
      src="https://static.cloudflareinsights.com/beacon.min.js"
      data-cf-beacon={JSON.stringify({ token, spa: true })}
    />
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="hu">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
        <WebAnalytics />
      </body>
    </html>
  );
}

// A thin bar at the top while the next page loads, so a click shows at once.
// It only appears after 120 ms, so fast navigations don't flicker.
function NavigationProgress() {
  const busy = useNavigation().state !== "idle";
  return (
    <div
      aria-hidden="true"
      className={`nav-progress pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 bg-ball ${busy ? "is-busy" : ""}`}
    />
  );
}

export default function App() {
  return (
    <>
      <NavigationProgress />
      <Outlet />
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 403) return <Forbidden />;
  let message = "Hoppá!";
  let details = "Váratlan hiba történt.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Hiba";
    details =
      error.status === 404
        ? "Ez az oldal nem létezik."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="text-2xl font-bold">{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}

import { Link } from "react-router";

import type { Route } from "./+types/app.home";
import { AppPage } from "~/components/app-page";
import { getActor } from "~/lib/auth/admin.server";
import { appNav, navLeagues } from "~/lib/auth/permissions";
import { requireUser } from "~/lib/auth/session.server";
import { listLeagues } from "~/lib/leagues.server";
import { SITE_NAME } from "~/lib/site";

// The app's home (Kezdőlap): where the sidebar logo and a login lead. For now
// a greeting and shortcuts; with the season it becomes "your group, your next
// match". The public landing page stays at "/".

export function meta({}: Route.MetaArgs) {
  return [{ title: `Kezdőlap – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  const nav = appNav(actor, navLeagues(actor, actor.platformRole === "superadmin" ? await listLeagues() : []));
  return {
    // Accounts from before the level was asked for: nudge them to the profile.
    needsLevel: !user.level,
    shortcuts: nav.filter((s) => s.label).map((s) => ({ label: s.label, role: s.role, items: s.items.map(({ label, to }) => ({ label, to })) })),
  };
}

export default function AppHome({ loaderData: d }: Route.ComponentProps) {
  return (
    <AppPage title="Kezdőlap">
      {d.needsLevel && (
        <section role="status" className="grid max-w-2xl gap-2 rounded-lg border border-nav-active bg-nav-active-bg p-6">
          <h2 className="font-display text-lg font-bold">Add meg a szinted</h2>
          <p>
            A jelentkezéshez kell a szinted, és innen indul az értékszámod.{" "}
            <Link to="/profile#adatok" className="font-semibold underline">
              Megadom a profilomban
            </Link>
          </p>
        </section>
      )}
      <section className="grid max-w-2xl gap-2 rounded-lg border border-dashed p-6">
        <h2 className="font-display text-lg font-bold">Hamarosan itt lesz a csoportod</h2>
        <p className="text-muted-foreground">
          Amint indul a szezon, itt látod a csoportodat, a következő meccsedet és az eredményeket. Addig a{" "}
          <Link to="/rules" className="underline">
            szabályzatot
          </Link>{" "}
          érdemes átfutni.
        </p>
      </section>
      {d.shortcuts.map((s) => (
        <section key={s.label} className="grid gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {s.label}
            {s.role && (
              <span className="rounded-full bg-nav-active-bg px-1.5 py-px text-[10px] font-semibold tracking-wide text-nav-active uppercase">
                {s.role}
              </span>
            )}
          </h2>
          <ul className="flex flex-wrap gap-2">
            {s.items.map((i) => (
              <li key={i.to}>
                <Link to={i.to} className="inline-block rounded-md border px-3 py-1.5 text-sm no-underline hover:bg-accent">
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </AppPage>
  );
}

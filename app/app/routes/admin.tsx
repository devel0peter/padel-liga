import { Link, NavLink, Outlet } from "react-router";

import type { Route } from "./+types/admin";
import { Wrap } from "~/components/site";
import { requireAdmin } from "~/lib/access.server";
import { SITE_NAME } from "~/lib/site";

export function meta({}: Route.MetaArgs) {
  return [{ title: `Admin – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const admin = await requireAdmin(request);
  return { email: admin.email };
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? "font-semibold no-underline" : "text-muted-foreground no-underline";

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <>
      <header className="border-b py-3">
        <Wrap className="flex items-center justify-between gap-4 text-sm">
          <nav className="flex items-center gap-4">
            <Link to="/admin" className="font-display text-base font-extrabold no-underline">
              {SITE_NAME} admin
            </Link>
            <NavLink to="/admin" end className={navClass}>
              Jelentkezők
            </NavLink>
            <NavLink to="/admin/levelek" className={navClass}>
              Körlevelek
            </NavLink>
            <NavLink to="/admin/klubok" className={navClass}>
              Klubok
            </NavLink>
          </nav>
          <span className="text-muted-foreground">{loaderData.email}</span>
        </Wrap>
      </header>
      <main className="py-6">
        <Outlet />
      </main>
    </>
  );
}

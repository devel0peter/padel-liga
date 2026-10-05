import { redirect } from "react-router";

import type { Route } from "./+types/admin._index";
import { Wrap } from "~/components/site";
import { requirePermission } from "~/lib/auth/admin.server";
import { adminHome } from "~/lib/auth/permissions";

// /admin opens the first page you may see. Old /admin?… links (the signup
// list used to live here) keep their filters.
export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "admin.enter" });
  const home = adminHome(actor);
  if (home) throw redirect(`${home}${new URL(request.url).search}`);
  return null;
}

// A Szervező before the league pages exist (docs/admin-plan.md, PR 3).
export default function AdminHome() {
  return (
    <Wrap className="grid max-w-xl gap-2 py-10">
      <h1 className="font-display text-2xl font-extrabold">Itt lesz a ligád</h1>
      <p className="text-muted-foreground">
        Szervező vagy, de a liga oldalai (szezonok, párok, csoportok) még készülnek. Amint elkészülnek, itt
        találod őket.
      </p>
    </Wrap>
  );
}

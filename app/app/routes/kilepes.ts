import { redirect } from "react-router";

import type { Route } from "./+types/kilepes";
import { destroyAllSessions, destroySession, getUser } from "~/lib/auth/session.server";

// POST only, so a link or a prefetch can't log anyone out.
export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData().catch(() => new FormData());
  const user = await getUser(request);
  if (user && form.get("everywhere") === "1") await destroyAllSessions(user.id);
  return redirect("/", { headers: { "Set-Cookie": await destroySession(request) } });
}

export function loader() {
  return redirect("/fiokom");
}

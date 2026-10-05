import { Form, Link } from "react-router";

import type { Route } from "./+types/account";
import { AuthPage } from "~/components/auth";
import { Button } from "~/components/ui/button";
import { hasGoogleLogin } from "~/lib/auth/accounts.server";
import { getActor } from "~/lib/auth/admin.server";
import { can, roleLabel } from "~/lib/auth/permissions";
import { requireUser } from "~/lib/auth/session.server";
import { SITE_NAME } from "~/lib/site";

// The account page. For now: who you are and logging out. Profile fields
// (phone, level) come with #16.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Fiókom – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = await getActor(request);
  return {
    name: user.name,
    email: user.email,
    google: await hasGoogleLogin(user.id),
    role: actor ? roleLabel(actor) : "Játékos",
    admin: can(actor, { kind: "admin.enter" }),
  };
}

export default function Account({ loaderData }: Route.ComponentProps) {
  return (
    <AuthPage title="Fiókom">
      <dl className="grid gap-3">
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">Név</dt>
          <dd>{loaderData.name}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">E-mail-cím</dt>
          <dd>{loaderData.email}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">Belépés</dt>
          <dd>{loaderData.google ? "Google-lel vagy e-mailes kóddal" : "E-mailes kóddal"}</dd>
        </div>
        <div className="grid gap-0.5">
          <dt className="text-sm text-muted-foreground">Szerep</dt>
          <dd>{loaderData.role}</dd>
        </div>
      </dl>
      {loaderData.admin && (
        <div>
          <Button asChild className="h-11 px-6 text-base">
            <Link to="/admin" className="no-underline">
              Admin felület
            </Link>
          </Button>
        </div>
      )}
      <Form method="post" action="/logout" className="flex flex-wrap gap-3">
        <Button type="submit" variant="outline" className="h-11 px-5">
          Kilépés
        </Button>
        <Button type="submit" name="everywhere" value="1" variant="ghost" className="h-11 px-5">
          Kilépés minden eszközön
        </Button>
      </Form>
    </AuthPage>
  );
}

import { Form } from "react-router";

import type { Route } from "./+types/fiokom";
import { AuthPage } from "~/components/auth";
import { Button } from "~/components/ui/button";
import { hasGoogleLogin } from "~/lib/auth/accounts.server";
import { requireUser } from "~/lib/auth/session.server";
import { SITE_NAME } from "~/lib/site";

// The account page. For now: who you are and logging out. Profile fields
// (phone, level) come with #16.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Fiókom – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  return { name: user.name, email: user.email, google: await hasGoogleLogin(user.id) };
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
      </dl>
      <Form method="post" action="/kilepes" className="flex flex-wrap gap-3">
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

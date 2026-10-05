import { Form } from "react-router";

import type { Route } from "./+types/profile";
import { AppPage } from "~/components/app-page";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { Button } from "~/components/ui/button";
import { hasGoogleLogin } from "~/lib/auth/accounts.server";
import { getActor } from "~/lib/auth/admin.server";
import { roleLabel } from "~/lib/auth/permissions";
import { initials } from "~/lib/auth/rules";
import { requireUser } from "~/lib/auth/session.server";
import { SITE_NAME } from "~/lib/site";

// The profile, inside the app shell (app.tsx). Profile fields (phone, level)
// come with #16.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Profil – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  return {
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    initials: initials(user.name, user.email),
    google: await hasGoogleLogin(user.id),
    role: roleLabel(actor),
    leagues: actor.leagues.map((l) => l.name),
  };
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function Profile({ loaderData: d }: Route.ComponentProps) {
  return (
    <AppPage title="Profil">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          {d.imageUrl && <AvatarImage src={d.imageUrl} alt="" referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-nav-active-bg text-lg font-bold text-nav-active">{d.initials}</AvatarFallback>
        </Avatar>
        <div className="grid gap-0.5">
          <p className="font-display text-xl font-extrabold">{d.name}</p>
          <p className="text-muted-foreground">{d.role}</p>
        </div>
      </div>

      <dl className="grid max-w-2xl gap-4">
        <Row label="E-mail-cím">{d.email}</Row>
        <Row label="Belépés">{d.google ? "Google-lel vagy e-mailes kóddal" : "E-mailes kóddal"}</Row>
        {d.leagues.length > 0 && <Row label="Szervező itt">{d.leagues.join(", ")}</Row>}
      </dl>

      <div className="grid max-w-2xl gap-3 border-t pt-6">
        <p className="text-sm text-muted-foreground">
          Ha egy eszközödet elhagytad, vagy idegen gépen felejtetted bejelentkezve, lépj ki mindenhonnan.
        </p>
        <Form method="post" action="/logout">
          <Button type="submit" name="everywhere" value="1" variant="outline">
            Kilépés minden eszközön
          </Button>
        </Form>
      </div>
    </AppPage>
  );
}

import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/pair-join";
import { AuthPage } from "~/components/auth";
import { Button } from "~/components/ui/button";
import { getUser, requireUser } from "~/lib/auth/session.server";
import { acceptPairLink, pairLinkPath, pairLinkView } from "~/lib/pair-links.server";
import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";

// A player's pair link (2026-10-31), opened by the partner they sent it to.
// Logged out: who invites and where, with registration and login, both of
// which come back here (through the first-login page for a new account).
// Logged in: "Elfogadom" makes the pair, or why it can't. Shows the owner's
// name only.

export const pairInvitation = (name: string) => `${name} meghívott, hogy legyél a párja.`;

export function meta({}: Route.MetaArgs) {
  return [{ title: `Meghívás párnak – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  // A started account finishes the first-login page first, then comes back.
  const user = (await getUser(request)) && (await requireUser(request));
  const view = await pairLinkView(params.token, user || null);
  const back = encodeURIComponent(pairLinkPath(params.token));
  return { view: view ?? null, loggedIn: !!user, register: `/register?returnTo=${back}`, login: `/login?returnTo=${back}` };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const result = await acceptPairLink(user, params.token);
  if (result.ok) return redirect("/pair?joined=1");
  return { error: result.error };
}

export default function PairJoin({ loaderData: d, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  if (!d.view)
    return (
      <AuthPage title="Ez a link nem él" intro={`Kérj új linket attól, aki küldte, vagy írj nekünk: ${CONTACT_EMAIL}`}>
        <Link to="/" className="underline">
          Vissza a főoldalra
        </Link>
      </AuthPage>
    );
  const error = actionData?.error ?? d.view.refusal;
  return (
    <AuthPage title="Meghívás párnak" intro={`${pairInvitation(d.view.ownerName)} (${d.view.league})`}>
      {!d.loggedIn ? (
        <div className="grid gap-3">
          <p className="text-sm text-muted-foreground">Regisztrálj vagy lépj be, és utána egy gombnyomással párban vagytok.</p>
          <Button asChild className="h-11 px-6 text-base">
            <Link to={d.register}>Regisztrálok</Link>
          </Button>
          <Button asChild variant="outline" className="h-11 px-6 text-base">
            <Link to={d.login}>Már van fiókom, belépek</Link>
          </Button>
        </div>
      ) : error ? (
        <div className="grid gap-3">
          <p role="alert" className="font-semibold text-destructive">
            {error}
          </p>
          <Link to="/pair" className="underline">
            Párom
          </Link>
        </div>
      ) : (
        <Form method="post" className="grid gap-3">
          <p className="text-sm text-muted-foreground">Egy ligában egy párod lehet. Ha elfogadod, nevezni már együtt tudtok.</p>
          <Button type="submit" disabled={busy} className="h-11 px-6 text-base">
            Elfogadom
          </Button>
        </Form>
      )}
    </AuthPage>
  );
}

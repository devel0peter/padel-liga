import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/pair-invite";
import { AppPage } from "~/components/app-page";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { normalizeEmail } from "~/lib/auth/rules";
import { requireUser } from "~/lib/auth/session.server";
import { ANSWER_REFUSALS, isInviteToken, type InviteStatus } from "~/lib/pairs";
import { answerInvite, inviteByToken } from "~/lib/pairs.server";
import { SITE_NAME } from "~/lib/site";

// The emailed link of a partner invite (#21): the same accept / decline as on
// /pair. Only the invitee (by email) sees who invited them; anyone else with
// the link learns nothing.

export function meta({}: Route.MetaArgs) {
  return [
    { title: `Pármeghívó – ${SITE_NAME}` },
    { name: "robots", content: "noindex" },
    // The token is in the URL: don't pass it on to other sites.
    { name: "referrer", content: "no-referrer" },
  ];
}

const DONE: Record<Exclude<InviteStatus, "pending">, string> = {
  accepted: "Ezt a meghívót már elfogadtad.",
  declined: "Ezt a meghívót nem kérted.",
  cancelled: "Ezt a meghívót visszavonták.",
};

async function invitee(request: Request, token: string | undefined) {
  const user = await requireUser(request);
  const invite = isInviteToken(token) ? await inviteByToken(token) : undefined;
  const mine = !!invite && normalizeEmail(invite.inviteeEmail) === normalizeEmail(user.email);
  return { user, invite: mine ? invite : undefined, found: !!invite };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { invite, found } = await invitee(request, params.token);
  if (!invite)
    return {
      state: "closed" as const,
      message: found ? ANSWER_REFUSALS.not_yours : "Ez a meghívó nem érvényes. Nézd meg, jól másoltad-e ki a linket.",
    };
  if (invite.status !== "pending") return { state: "closed" as const, message: DONE[invite.status] };
  return { state: "open" as const, inviterName: invite.inviterName, league: invite.league };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, invite } = await invitee(request, params.token);
  const intent = (await request.formData()).get("intent");
  if (intent !== "accept" && intent !== "decline") throw new Response("Hibás kérés.", { status: 400 });
  if (!invite) return { error: ANSWER_REFUSALS.not_yours };
  const result = await answerInvite(user, invite.id, intent);
  if (!result.ok) return { error: result.error };
  return redirect(`/pair?answered=${intent}`);
}

export default function PairInvite({ loaderData: d, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  return (
    <AppPage title="Pármeghívó">
      {d.state === "closed" ? (
        <div className="grid max-w-2xl gap-3">
          <p>{d.message}</p>
          <p>
            <Link to="/pair" className="underline">
              Tovább a párodhoz
            </Link>
          </p>
        </div>
      ) : (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="font-display text-lg">{d.inviterName} meghívott párnak</CardTitle>
            <CardDescription>{d.league}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-sm">Ha elfogadod, pár lesztek ebben a ligában, és együtt nevezhettek a szezonra.</p>
            {actionData?.error && (
              <p role="alert" className="font-semibold text-destructive">
                {actionData.error}
              </p>
            )}
            <Form method="post" className="flex flex-wrap gap-2">
              <Button type="submit" name="intent" value="accept" disabled={busy}>
                Elfogadom
              </Button>
              <Button type="submit" name="intent" value="decline" variant="outline" disabled={busy}>
                Nem kérem
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}
    </AppPage>
  );
}

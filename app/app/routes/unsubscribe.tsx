import { Form } from "react-router";

import type { Route } from "./+types/unsubscribe";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { Button } from "~/components/ui/button";
import { emailSecret, suppress } from "~/lib/email/outbox.server";
import { verifyUnsubscribeToken } from "~/lib/email/unsubscribe";
import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";

export function meta({}: Route.MetaArgs) {
  return [{ title: `Leiratkozás – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function emailFrom(request: Request): Promise<string | null> {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  return verifyUnsubscribeToken(token, emailSecret());
}

// GET only shows a button: link scanners in mail systems open links, and
// must not unsubscribe anyone.
export async function loader({ request }: Route.LoaderArgs) {
  return { valid: (await emailFrom(request)) != null };
}

// Both the button and mail clients' one-click unsubscribe (RFC 8058) POST here.
export async function action({ request }: Route.ActionArgs) {
  const email = await emailFrom(request);
  if (!email) return { done: false };
  await suppress(email, "unsubscribed");
  return { done: true };
}

export default function Unsubscribe({ loaderData, actionData }: Route.ComponentProps) {
  return (
    <>
      <SiteHeader cta={false} />
      <main className="py-16">
        <Wrap className="grid max-w-xl gap-4">
          <h1 className="font-display text-3xl font-black">Leiratkozás</h1>
          {actionData?.done ? (
            <p>Leiratkoztál, nem küldünk több körlevelet. Ha meggondolod magad, írj a {CONTACT_EMAIL} címre.</p>
          ) : loaderData.valid ? (
            <>
              <p>Nem kérsz több körlevelet a {SITE_NAME}tól?</p>
              <Form method="post">
                <Button type="submit">Leiratkozom</Button>
              </Form>
            </>
          ) : (
            <p>
              Ez a leiratkozó link nem érvényes. Írj a {CONTACT_EMAIL} címre, és leiratkoztatunk.
            </p>
          )}
        </Wrap>
      </main>
      <SiteFooter />
    </>
  );
}

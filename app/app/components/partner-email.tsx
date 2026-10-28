import { useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

// "Partner has no email" (#96, D35), on the home page and Párom: the player's
// pair signup names a partner without an address. The form posts intent
// "partner_email" to the page's own action. Shows the partner's name only.

export const PARTNER_EMAIL_SAVED = "Elmentettük. Ha még nincs fiókja, most megkapja a meghívót.";

export function partnerEmailPrompt(name: string): string {
  return `A párodnak (${name}) nincs e-mail-címe nálunk. Add meg, és ő is kap meghívót.`;
}

export function PartnerEmailBox({ signupId, name }: { signupId: number; name: string }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const busy = fetcher.state !== "idle";
  const id = `partner-email-${signupId}`;
  if (fetcher.data?.ok)
    return (
      <p role="status" className="max-w-2xl rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm font-medium">
        {PARTNER_EMAIL_SAVED}
      </p>
    );
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardDescription className="text-base text-foreground">{partnerEmailPrompt(name)}</CardDescription>
      </CardHeader>
      <CardContent>
        <fetcher.Form method="post" className="grid gap-3">
          <input type="hidden" name="intent" value="partner_email" />
          <input type="hidden" name="signup" value={signupId} />
          <div className="grid gap-1.5">
            <Label htmlFor={id}>A párod e-mail-címe</Label>
            <Input
              id={id}
              name="email"
              type="email"
              autoComplete="off"
              required
              aria-invalid={fetcher.data?.error ? true : undefined}
              aria-describedby={fetcher.data?.error ? `${id}-error` : undefined}
            />
            {fetcher.data?.error && (
              <p id={`${id}-error`} className="text-sm font-semibold text-destructive">
                {fetcher.data.error}
              </p>
            )}
          </div>
          <div>
            <Button type="submit" disabled={busy}>
              Mentés
            </Button>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

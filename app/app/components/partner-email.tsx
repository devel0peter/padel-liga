import { useFetcher } from "react-router";

import { Field, inputClass, invalid } from "~/components/auth";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";

// "Partner has no email" (#96, D35): the player's pair signup names a partner
// without an address. On the home page and Párom a box whose form posts
// intent "partner_email" to the page's own action; on the first-login page
// (#130) a field of that page's form. Shows the partner's name only.

export const PARTNER_EMAIL_SAVED = "Elmentettük. Ha még nincs fiókja, most megkapja a meghívót.";

export function partnerEmailPrompt(name: string): string {
  return `A párodnak (${name}) nincs e-mail-címe nálunk. Add meg, és ő is kap meghívót.`;
}

// The same question on the first-login page (#130): an optional field of
// that page's own form, saved with "Kész".
export function PartnerEmailField({ signupId, name, error }: { signupId: number; name: string; error?: string }) {
  const field = `partnerEmail-${signupId}`;
  return (
    <Field name={field} label="A párod e-mail-címe (nem kötelező)" error={error}>
      <p className="text-sm text-muted-foreground">{partnerEmailPrompt(name)}</p>
      <Input id={field} name={field} type="email" autoComplete="off" maxLength={254} className={inputClass} {...invalid(field, error)} />
    </Field>
  );
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

import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/welcome";
import { AuthPage, Field, FieldError, inputClass, invalid } from "~/components/auth";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { saveProfile } from "~/lib/auth/accounts.server";
import { safeReturnTo, validateProfile, type ProfileErrors } from "~/lib/auth/rules";
import { requireAccount } from "~/lib/auth/session.server";
import { SITE_NAME } from "~/lib/site";

// First login: name and privacy consent (spec section 3) before anything else.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Üdv a ${SITE_NAME}on` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAccount(request);
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  if (user.consentAt) throw redirect(returnTo);
  return { name: user.name, email: user.email, returnTo };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAccount(request);
  const form = await request.formData();
  const result = validateProfile({ name: form.get("name"), consent: form.get("consent") });
  if (!result.ok) return { errors: result.errors };
  await saveProfile(user.id, result.value);
  return redirect(safeReturnTo(String(form.get("returnTo") ?? "")));
}

export default function Welcome({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const errors: ProfileErrors = actionData?.errors ?? {};
  return (
    <AuthPage title="Üdv!" intro={<>Még két dolog, és kész. Belépve: {loaderData.email}</>}>
      <Form method="post" className="grid gap-5">
        <input type="hidden" name="returnTo" value={loaderData.returnTo} />
        <Field name="name" label="Neved" error={errors.name}>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            required
            maxLength={80}
            defaultValue={loaderData.name}
            className={inputClass}
            {...invalid("name", errors.name)}
          />
        </Field>
        <div className="grid gap-1.5">
          <div className="flex items-start gap-3">
            <Checkbox id="consent" name="consent" className="mt-0.5 size-5" {...invalid("consent", errors.consent)} />
            <Label htmlFor="consent" className="block text-sm leading-relaxed font-normal text-muted-foreground">
              Elolvastam az{" "}
              <Link to="/privacy" target="_blank" className="underline">
                adatkezelési tájékoztatót
              </Link>
              , és hozzájárulok, hogy az adataimat a liga szervezéséhez kezeljétek. Bármikor visszavonhatom.
            </Label>
          </div>
          <FieldError id="consent-error" message={errors.consent} />
        </div>
        <div>
          <Button type="submit" disabled={busy} className="h-11 px-6 text-base">
            Kész
          </Button>
        </div>
      </Form>
    </AuthPage>
  );
}

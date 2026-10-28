import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/welcome";
import { AuthPage, FieldError, invalid } from "~/components/auth";
import { ProfileFields } from "~/components/profile-fields";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { saveProfile } from "~/lib/auth/accounts.server";
import { interestLevelFor } from "~/lib/interest.server";
import { formatPhone } from "~/lib/phone";
import { safeReturnTo, validateProfile, type ProfileErrors } from "~/lib/auth/rules";
import { requireAccount } from "~/lib/auth/session.server";
import { formSignupPairs, signupPartnerNames } from "~/lib/signup-partners.server";
import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";

// First login: name, level, an optional phone number and the privacy consent
// (spec section 3) before anything else. A player the signups pair with
// someone sees the partner's name, with our address if it's wrong (#96).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Üdv a ${SITE_NAME}on` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAccount(request);
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  if (user.consentAt) throw redirect(returnTo);
  // Someone from the interest list already told us their level.
  const level = user.level ?? (await interestLevelFor(user.email));
  const partners = await signupPartnerNames(user.email);
  return { name: user.name, email: user.email, level, phone: formatPhone(user.phone), returnTo, partners };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAccount(request);
  const form = await request.formData();
  const result = validateProfile(
    { name: form.get("name"), level: form.get("level"), phone: form.get("phone"), consent: form.get("consent") },
    { requireConsent: true },
  );
  if (!result.ok) return { errors: result.errors };
  await saveProfile(user.id, result.value);
  // Registered now: the pair from the interest signup, if the partner is too (D27).
  await formSignupPairs(user.id);
  return redirect(safeReturnTo(String(form.get("returnTo") ?? "")));
}

export default function Welcome({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const errors: ProfileErrors = actionData?.errors ?? {};
  return (
    <AuthPage title="Üdv!" intro={<>Pár adat, és kész. Belépve: {loaderData.email}</>}>
      {loaderData.partners.map((name) => (
        <p key={name} role="status" className="mb-5 rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm">
          <span className="font-semibold">A párod: {name}.</span> Nem ő? Írj nekünk: {CONTACT_EMAIL}
        </p>
      ))}
      <Form method="post" className="grid gap-5">
        <input type="hidden" name="returnTo" value={loaderData.returnTo} />
        <ProfileFields errors={errors} values={{ name: loaderData.name, level: loaderData.level, phone: loaderData.phone }} />
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

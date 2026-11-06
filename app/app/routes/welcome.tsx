import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/welcome";
import { AuthPage, FieldError, invalid } from "~/components/auth";
import { ProfileFields, SexField } from "~/components/profile-fields";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { saveProfile, saveSex } from "~/lib/auth/accounts.server";
import { formatPhone } from "~/lib/phone";
import { parseSex, safeReturnTo, SEX_REQUIRED, validateProfile, type ProfileErrors } from "~/lib/auth/rules";
import { requireAccount } from "~/lib/auth/session.server";
import { SITE_NAME } from "~/lib/site";

// First login: name, level, phone number and the privacy consent
// (spec section 3) before anything else. Nothing comes from the interest
// list (#333, D128): a Google login brings its name, the rest is typed here.
// Férfi or Nő is asked too (#133); an account from before that question gets
// only it, once (requireUser sends it here).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Üdv a ${SITE_NAME}on` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAccount(request);
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  if (user.consentAt && user.sex) throw redirect(returnTo);
  // An account from before the question (#133): only that, once.
  if (user.consentAt) return { onlySex: true as const, returnTo };
  return {
    onlySex: false as const,
    // A Google login brings its own name; a code login has none yet.
    name: user.name,
    level: user.level,
    email: user.email,
    phone: formatPhone(user.phone),
    returnTo,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireAccount(request);
  const form = await request.formData();
  const back = safeReturnTo(String(form.get("returnTo") ?? ""));
  if (user.consentAt) {
    // The one-time question (#133); nothing else changes.
    const sex = parseSex(form.get("sex"));
    if (!sex) return { errors: { sex: SEX_REQUIRED } };
    await saveSex(user.id, sex);
    return redirect(back);
  }
  const result = validateProfile(
    {
      name: form.get("name"),
      level: form.get("level"),
      phone: form.get("phone"),
      consent: form.get("consent"),
      sex: form.get("sex"),
    },
    { requireConsent: true },
  );
  if (!result.ok) return { errors: result.errors };
  await saveProfile(user.id, result.value);
  return redirect(back);
}

export default function Welcome({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const errors: ProfileErrors = actionData?.errors ?? {};
  if (loaderData.onlySex)
    return (
      <AuthPage title="Még egy kérdés" intro="Új mezőt vettünk fel a profilba. Csak ennyi, és mehetsz tovább.">
        <Form method="post" className="grid gap-5">
          <input type="hidden" name="returnTo" value={loaderData.returnTo} />
          <SexField error={errors.sex} />
          <div>
            <Button type="submit" disabled={busy} className="h-11 px-6 text-base">
              Mentés
            </Button>
          </div>
        </Form>
      </AuthPage>
    );
  return (
    <AuthPage
      title="Üdv!"
      intro={<>Pár adat, és kész. Belépve: {loaderData.email}</>}
    >
      <Form method="post" className="grid gap-5">
        <input type="hidden" name="returnTo" value={loaderData.returnTo} />
        <ProfileFields errors={errors} values={{ name: loaderData.name, level: loaderData.level, phone: loaderData.phone, sex: null }} />
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

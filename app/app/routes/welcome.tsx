import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/welcome";
import { AuthPage, FieldError, invalid } from "~/components/auth";
import { PartnerEmailField } from "~/components/partner-email";
import { ProfileFields, SexField } from "~/components/profile-fields";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Label } from "~/components/ui/label";
import { saveProfile, saveSex } from "~/lib/auth/accounts.server";
import { interestProfileFor } from "~/lib/interest.server";
import { formatPhone } from "~/lib/phone";
import { parseSex, safeReturnTo, SEX_REQUIRED, validateProfile, type ProfileErrors } from "~/lib/auth/rules";
import { requireAccount } from "~/lib/auth/session.server";
import { formSignupPairs, missingPartnerEmails, savePartnerEmail, signupPartnerNames } from "~/lib/signup-partners.server";
import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";

// First login: name, level, phone number and the privacy consent
// (spec section 3) before anything else. Someone from the interest list
// finds their name and level already filled in from their newest signup
// (#130). A player the signups pair with someone sees the partner's name,
// with our address if it's wrong; one whose pair signup has no partner
// address may add it here (#96). Férfi or Nő is asked too (#133); an account
// from before that question gets only it, once (requireUser sends it here).

export const FROM_SIGNUP = "A jelentkezésedből már megvan a neved és a szinted, csak a telefonszámod kell.";

export function meta({}: Route.MetaArgs) {
  return [{ title: `Üdv a ${SITE_NAME}on` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireAccount(request);
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  if (user.consentAt && user.sex) throw redirect(returnTo);
  // An account from before the question (#133): only that, once.
  if (user.consentAt) return { onlySex: true as const, returnTo };
  const [signup, partners, missing] = await Promise.all([
    interestProfileFor(user.email),
    signupPartnerNames(user.email),
    missingPartnerEmails(user),
  ]);
  return {
    onlySex: false as const,
    // A Google login brings its own name; a code login has none yet.
    name: user.name || signup?.name || "",
    level: user.level ?? signup?.level ?? null,
    fromSignup: !!signup?.name && !!signup.level,
    email: user.email,
    phone: formatPhone(user.phone),
    returnTo,
    partners,
    partnerEmails: missing.map(({ signupId, name }) => ({ signupId, name })),
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
  // The partner's address, if they typed one (#96): saved and invited as
  // from the box on the home page. A refused address keeps the page open.
  const partnerErrors: Record<number, string> = {};
  for (const box of await missingPartnerEmails(user)) {
    const typed = String(form.get(`partnerEmail-${box.signupId}`) ?? "").trim();
    if (!typed) continue;
    const saved = await savePartnerEmail(user, box.signupId, typed);
    if (!saved.ok) partnerErrors[box.signupId] = saved.error;
  }
  if (Object.keys(partnerErrors).length > 0) return { errors: {}, partnerErrors };
  await saveProfile(user.id, result.value);
  // Registered now: the pair from the interest signup, if the partner is too (D27).
  await formSignupPairs(user.id);
  return redirect(back);
}

export default function Welcome({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const errors: ProfileErrors = actionData?.errors ?? {};
  const partnerErrors: Record<number, string> = (actionData && "partnerErrors" in actionData && actionData.partnerErrors) || {};
  if (loaderData.onlySex)
    return (
      <AuthPage title="Még egy kérdés" intro="Új mezőt vettünk fel a profilba. Egy kattintás, és mehetsz tovább.">
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
      intro={
        <>
          {loaderData.fromSignup ? FROM_SIGNUP : "Pár adat, és kész."} Belépve: {loaderData.email}
        </>
      }
    >
      {loaderData.partners.map((name) => (
        <p key={name} role="status" className="mb-5 rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm">
          <span className="font-semibold">A párod: {name}.</span> Nem ő? Írj nekünk: {CONTACT_EMAIL}
        </p>
      ))}
      <Form method="post" className="grid gap-5">
        <input type="hidden" name="returnTo" value={loaderData.returnTo} />
        <ProfileFields errors={errors} values={{ name: loaderData.name, level: loaderData.level, phone: loaderData.phone, sex: null }} />
        {loaderData.partnerEmails.map((p) => (
          <PartnerEmailField key={p.signupId} signupId={p.signupId} name={p.name} error={partnerErrors[p.signupId]} />
        ))}
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

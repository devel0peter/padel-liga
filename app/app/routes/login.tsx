import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/login";
import { AuthPage, Field, GoogleMark, inputClass, invalid } from "~/components/auth";
import { Button } from "~/components/ui/button";
import { Turnstile } from "~/components/turnstile";
import { Input } from "~/components/ui/input";
import { googleConfigured, type GoogleError } from "~/lib/auth/google.server";
import { sendLoginCode, verifyLoginCode } from "~/lib/auth/login-code.server";
import { loginEmailParam, safeReturnTo } from "~/lib/auth/rules";
import { createSession, getUser } from "~/lib/auth/session.server";
import { formSignupPairs } from "~/lib/signup-partners.server";
import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";
import { turnstileSiteKey, verifyTurnstile } from "~/lib/turnstile.server";

// Login and registration (/register) are the same flow: the first login of
// a new address creates the account (#113). /register is its own page with
// its own words, so someone looking for registration doesn't land on
// "Belépés" (2026-10-31). Both come back to `returnTo`.

export type AuthMode = "login" | "register";

const WORDS = {
  login: {
    title: "Belépés",
    intro: "Nincs jelszó: lépj be Google-lel, vagy kérj egy belépőkódot",
    google: "Belépés Google-lel",
    googleHint: "lépj be Google-lel",
    verify: "Belépek",
    other: { text: "Még nincs fiókod?", link: "Regisztráció", to: "/register" },
  },
  register: {
    title: "Regisztráció",
    intro: "Nincs jelszó: regisztrálj Google-lel, vagy kérj egy kódot",
    google: "Regisztráció Google-lel",
    googleHint: "regisztrálj Google-lel",
    verify: "Tovább",
    other: { text: "Már van fiókod?", link: "Belépés", to: "/login" },
  },
} as const;

export function meta({}: Route.MetaArgs) {
  return [{ title: `Belépés – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

const GOOGLE_ERRORS: Record<GoogleError, string> = {
  google: "A Google-belépés nem sikerült. Próbáld újra, vagy kérj kódot e-mailben.",
  "unverified": "Ennek a Google-fióknak nincs megerősített e-mail-címe. Kérj kódot e-mailben.",
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  if (await getUser(request)) throw redirect(returnTo);
  const code = url.searchParams.get("error") as GoogleError | null;
  return {
    google: googleConfigured(),
    returnTo,
    // Prefilled from the registration invite link (#20).
    email: loginEmailParam(url.searchParams.get("email")),
    error: code && code in GOOGLE_ERRORS ? GOOGLE_ERRORS[code] : null,
    turnstileSiteKey: turnstileSiteKey(),
  };
}

type ActionData = { step: "email"; error: string; email: string } | { step: "code"; email: string; error?: string; resent?: boolean };

export async function action({ request }: Route.ActionArgs): Promise<ActionData | Response> {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const returnTo = safeReturnTo(String(form.get("returnTo") ?? ""));

  if (form.get("intent") === "verify") {
    const result = await verifyLoginCode(email, String(form.get("code") ?? ""));
    if (!result.ok) return { step: "code", email, error: result.error };
    await formSignupPairs(result.userId);
    return redirect(returnTo, { headers: { "Set-Cookie": await createSession(result.userId) } });
  }

  // Every code is an email, so sending one needs the bot check.
  const result = (await verifyTurnstile(form, request, "login"))
    ? await sendLoginCode(email)
    : ({ ok: false, error: "Nem sikerült ellenőrizni, hogy nem vagy robot. Várj pár másodpercet, és próbáld újra." } as const);
  if (!result.ok) {
    // A failed resend keeps the code step open; the earlier code may still work.
    return form.get("intent") === "resend" ? { step: "code", email, error: result.error } : { step: "email", email, error: result.error };
  }
  return { step: "code", email: result.email, resent: form.get("intent") === "resend" };
}

export default function Login(props: Route.ComponentProps) {
  return <AuthForm {...props} mode="login" />;
}

export function AuthForm({ loaderData, actionData, mode }: Pick<Route.ComponentProps, "loaderData" | "actionData"> & { mode: AuthMode }) {
  const words = WORDS[mode];
  const self = mode === "login" ? "/login" : "/register";
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const { google, returnTo, error, turnstileSiteKey } = loaderData;
  // A token is single use: a new one after every send or resend.
  const turnstile = turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} action="login" resetKey={actionData} />;

  if (actionData?.step === "code") {
    return (
      <AuthPage
        title="Nézd meg a leveleidet"
        intro={
          <>
            Küldtünk egy 6 jegyű kódot ide: <strong className="text-foreground">{actionData.email}</strong>. 10 percig
            érvényes.
          </>
        }
      >
        <Form method="post" className="grid gap-4">
          <input type="hidden" name="email" value={actionData.email} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <Field name="code" label="Belépőkód" error={actionData.error}>
            <Input
              id="code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 \-]*"
              maxLength={7}
              required
              autoFocus
              className={`${inputClass} max-w-48 text-lg tracking-[0.3em] tabular-nums`}
              {...invalid("code", actionData.error)}
            />
          </Field>
          {actionData.resent && !actionData.error && <p className="text-sm text-muted-foreground">Új kódot küldtünk.</p>}
          {turnstile}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" name="intent" value="verify" disabled={busy} className="h-11 px-6 text-base">
              {words.verify}
            </Button>
            <Button type="submit" name="intent" value="resend" variant="ghost" disabled={busy} formNoValidate>
              Új kódot kérek
            </Button>
          </div>
        </Form>
        {/* The same for every address (#123): a code to a new address may be
            skipped (bounced, daily cap), and the page must not tell which. */}
        <p className="text-sm text-muted-foreground">
          Nem jött meg? Nézd meg a spam mappát is,{" "}
          <Link to={`${self}?returnTo=${encodeURIComponent(returnTo)}`} className="underline">
            adj meg másik címet
          </Link>
          ,{" "}
          {google && (
            <>
              <a href={`/auth/google?returnTo=${encodeURIComponent(returnTo)}`} className="underline">
                {words.googleHint}
              </a>
              ,{" "}
            </>
          )}
          vagy írj nekünk:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </AuthPage>
    );
  }

  const emailError = actionData?.step === "email" ? actionData.error : undefined;
  return (
    <AuthPage
      title={words.title}
      intro={
        <>
          {words.intro} <span className="whitespace-nowrap">e-mailben</span>.
        </>
      }
      below={
        <>
          {words.other.text}{" "}
          <Link to={`${words.other.to}?returnTo=${encodeURIComponent(returnTo)}`} className="underline">
            {words.other.link}
          </Link>
          <br />
          Nálatok még nincs liga?{" "}
          <Link to="/#mas-varos" className="underline">
            Szólj, és értesítünk
          </Link>
        </>
      }
    >
      {error && (
        <p role="alert" className="font-semibold text-destructive">
          {error}
        </p>
      )}
      {google && (
        <>
          <Button asChild variant="outline" className="h-11 gap-3 text-base">
            <a href={`/auth/google?returnTo=${encodeURIComponent(returnTo)}`}>
              <GoogleMark />
              {words.google}
            </a>
          </Button>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            vagy
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}
      <Form method="post" className="grid gap-4">
        <input type="hidden" name="returnTo" value={returnTo} />
        <Field name="email" label="E-mail-cím" error={emailError}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={actionData?.email ?? loaderData.email}
            className={inputClass}
            {...invalid("email", emailError)}
          />
        </Field>
        {turnstile}
        <div>
          <Button type="submit" name="intent" value="send" disabled={busy} className="h-11 w-full text-base">
            {busy ? "Küldés…" : "Kódot kérek"}
          </Button>
        </div>
      </Form>
    </AuthPage>
  );
}

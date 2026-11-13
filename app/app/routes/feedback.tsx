import { useState } from "react";
import { Form, Link, useNavigation } from "react-router";

import type { Route } from "./+types/feedback";
import { AuthPage, FieldError, invalid } from "~/components/auth";
import { Turnstile } from "~/components/turnstile";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { APP_VERSION } from "~/lib/app-version";
import { safeReturnTo } from "~/lib/auth/rules";
import { getUser } from "~/lib/auth/session.server";
import { browserFamily, DEVICE_LABELS, deviceClass, FORM_KINDS, KIND_LABELS, MESSAGE_MAX, pagePath } from "~/lib/feedback";
import { submitFeedback } from "~/lib/feedback.server";
import { formatDateTime } from "~/lib/format";
import { CONTACT_EMAIL, SITE_NAME } from "~/lib/site";
import { turnstileSiteKey } from "~/lib/turnstile.server";

// Visszajelzés (#240, spec 19, D94): anyone sends a bug report, an idea or
// something else from any page. The page it was opened from comes in
// ?from=; the context sent along is listed above the button. Visitors pass
// the signup's bot check (Turnstile). Nothing is mailed or notified.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Visszajelzés – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const from = new URL(request.url).searchParams.get("from");
  const user = await getUser(request);
  const userAgent = request.headers.get("User-Agent");
  return {
    from: from ?? "",
    // The link on the thank-you: the page itself, query string and all, if
    // it is one of ours; else the start page.
    back: from && safeReturnTo(from) === from ? from : user ? "/home" : "/",
    page: pagePath(from),
    sentAt: formatDateTime(new Date()),
    device: DEVICE_LABELS[deviceClass(userAgent)],
    browser: browserFamily(userAgent),
    version: APP_VERSION,
    account: user ? user.name || "a fiókod" : null,
    // Logged in: no bot check.
    turnstileSiteKey: user ? null : turnstileSiteKey(),
  };
}

type ActionData = { ok: true } | { ok: false; error: string; kind: string; message: string };

export async function action({ request }: Route.ActionArgs): Promise<ActionData> {
  const form = await request.formData();
  const user = await getUser(request);
  const result = await submitFeedback(form, request, user?.id ?? null);
  if (result.ok) return result;
  return { ok: false, error: result.error, kind: String(form.get("kind") ?? ""), message: String(form.get("message") ?? "") };
}

export default function Feedback({ loaderData, actionData }: Route.ComponentProps) {
  const { from, back, page, sentAt, device, browser, version, account, turnstileSiteKey } = loaderData;
  const busy = useNavigation().state !== "idle";
  const [botOk, setBotOk] = useState(false);
  const blocked = Boolean(turnstileSiteKey) && !botOk;
  const failed = actionData && !actionData.ok ? actionData : null;

  if (actionData?.ok) {
    return (
      <AuthPage title="Köszi, megkaptuk!" intro="Elolvassuk, és ha kell, javítjuk.">
        <Button asChild className="h-11 text-base">
          <Link to={back}>Vissza oda, ahonnan jöttél</Link>
        </Button>
      </AuthPage>
    );
  }

  const context = [
    ["Oldal", page || "–"],
    ["Időpont", sentAt],
    ["Eszköz", device],
    ["Böngésző", browser],
    ["Verzió", version],
    ...(account ? [["Fiók", account]] : []),
  ];

  return (
    <AuthPage title="Visszajelzés" intro="Valami nem működik, vagy van egy ötleted? Írd meg nekünk.">
      <Form method="post" className="grid gap-5">
        <input type="hidden" name="from" value={from} />
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">Miről szól?</legend>
          <RadioGroup name="kind" required defaultValue={failed?.kind || undefined} className="flex flex-wrap gap-x-5 gap-y-2">
            {FORM_KINDS.map((kind) => (
              <div key={kind} className="flex items-center gap-2">
                <RadioGroupItem id={`kind-${kind}`} value={kind} />
                <Label htmlFor={`kind-${kind}`}>{KIND_LABELS[kind]}</Label>
              </div>
            ))}
          </RadioGroup>
        </fieldset>
        <div className="grid gap-1.5">
          <Label htmlFor="message" className="font-semibold">
            Üzenet
          </Label>
          <Textarea
            id="message"
            name="message"
            required
            maxLength={MESSAGE_MAX}
            rows={6}
            defaultValue={failed?.message}
            className="bg-background text-base"
            {...invalid("message", failed?.error)}
          />
          <p className="text-sm text-muted-foreground">Ne írj bele jelszót, és mások személyes adatait se.</p>
        </div>
        <div className="grid gap-1 rounded-lg bg-muted/60 p-3 text-sm">
          <p className="font-semibold">Ezt küldjük el veled:</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
            {context.map(([label, value]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd className="min-w-0 break-words text-foreground">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {turnstileSiteKey && <Turnstile siteKey={turnstileSiteKey} action="feedback" resetKey={actionData} onReady={setBotOk} />}
        <FieldError id="message-error" message={failed?.error} />
        <Button type="submit" disabled={busy || blocked} className="h-11 text-base">
          {busy ? "Küldés…" : "Küldés"}
        </Button>
        <p className="text-sm text-muted-foreground">
          E-mailben nem válaszolunk. Ha választ szeretnél, írj ide:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="underline">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Form>
    </AuthPage>
  );
}

import { data, Form, Link, useFetcher, useNavigation } from "react-router";

import type { Route } from "./+types/profile";
import { AppPage } from "~/components/app-page";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { ProfileFields } from "~/components/profile-fields";
import { PushSettings } from "~/components/push-settings";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { hasGoogleLogin, updateProfile } from "~/lib/auth/accounts.server";
import { getActor } from "~/lib/auth/admin.server";
import { roleLabel } from "~/lib/auth/permissions";
import { initials, validateProfile, type ProfileErrors } from "~/lib/auth/rules";
import { requireUser } from "~/lib/auth/session.server";
import { isEnabled, isNotificationKind, kindsFor, NOTIFICATION_KINDS } from "~/lib/notifications";
import { disabledKindsFor, setKindEnabled, vapidPublicKey } from "~/lib/notifications.server";
import { formatPhone } from "~/lib/phone";
import { SITE_NAME } from "~/lib/site";

// The profile, inside the app shell (app.tsx): name, level and phone number
// (the phone is never shown to anyone else on this page or any public page),
// notification settings, logout everywhere.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Profil – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  return {
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    level: user.level,
    phone: formatPhone(user.phone),
    initials: initials(user.name, user.email),
    google: await hasGoogleLogin(user.id),
    role: roleLabel(actor),
    leagues: actor.leagues.map((l) => l.name),
    vapidPublicKey: vapidPublicKey(),
    kinds: await (async () => {
      const disabled = await disabledKindsFor(user.id);
      return kindsFor(actor).map((kind) => ({ kind, ...NOTIFICATION_KINDS[kind], enabled: isEnabled(disabled, kind) }));
    })(),
  };
}

// Saves the profile form, or switches one notification kind on or off
// (Értesítések section).
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  const form = await request.formData();
  if (form.get("intent") === "profile") {
    const result = validateProfile(
      { name: form.get("name"), level: form.get("level"), phone: form.get("phone") },
      { requireConsent: false },
    );
    if (!result.ok) return data({ saved: false, errors: result.errors }, { status: 400 });
    await updateProfile(user.id, result.value);
    return { saved: true, errors: {} as ProfileErrors };
  }
  const kind = form.get("kind");
  if (!isNotificationKind(kind) || !kindsFor(actor).includes(kind)) return data({ ok: false }, { status: 400 });
  await setKindEnabled(user.id, kind, form.get("enabled") === "1");
  return { ok: true };
}

type Kind = Route.ComponentProps["loaderData"]["kinds"][number];

function KindSwitch({ k }: { k: Kind }) {
  const fetcher = useFetcher();
  // Optimistic: show the new value while it saves.
  const pending = fetcher.formData?.get("enabled");
  const checked = pending != null ? pending === "1" : k.enabled;
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={`kind-${k.kind}`}
        checked={checked}
        onCheckedChange={(on) => fetcher.submit({ kind: k.kind, enabled: on ? "1" : "0" }, { method: "post" })}
        className="mt-0.5"
      />
      <div className="grid gap-0.5">
        <Label htmlFor={`kind-${k.kind}`}>{k.label}</Label>
        <p className="text-sm text-muted-foreground">{k.description}</p>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export default function Profile({ loaderData: d, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const errors: ProfileErrors = (actionData && "errors" in actionData ? actionData.errors : null) ?? {};
  const saved = !!actionData && "saved" in actionData && actionData.saved;
  return (
    <AppPage title="Profil">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          {d.imageUrl && <AvatarImage src={d.imageUrl} alt="" referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-nav-active-bg text-lg font-bold text-nav-active">{d.initials}</AvatarFallback>
        </Avatar>
        <div className="grid gap-0.5">
          <p className="font-display text-xl font-extrabold">{d.name}</p>
          <p className="text-muted-foreground">{d.role}</p>
        </div>
      </div>

      <section id="adatok" className="grid max-w-2xl scroll-mt-6 gap-4">
        <h2 className="font-display text-lg font-extrabold">Adataid</h2>
        {!d.level && (
          <p role="status" className="rounded-md border border-dashed p-3 text-sm">
            Még nem adtad meg a szinted. Kell a jelentkezéshez.
          </p>
        )}
        <Form method="post" className="grid gap-5">
          <input type="hidden" name="intent" value="profile" />
          <ProfileFields errors={errors} values={{ name: d.name, level: d.level, phone: d.phone }} />
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={busy}>
              Mentés
            </Button>
            {saved && !busy && (
              <p role="status" className="text-sm text-muted-foreground">
                Elmentettük.
              </p>
            )}
          </div>
        </Form>
      </section>

      <dl className="grid max-w-2xl gap-4 border-t pt-6">
        <Row label="E-mail-cím">{d.email}</Row>
        <Row label="Belépés">{d.google ? "Google-lel vagy e-mailes kóddal" : "E-mailes kóddal"}</Row>
        {d.leagues.length > 0 && <Row label="Szervező itt">{d.leagues.join(", ")}</Row>}
      </dl>

      <section id="ertesitesek" className="grid max-w-2xl scroll-mt-6 gap-4 border-t pt-6">
        <div className="grid gap-1">
          <h2 className="font-display text-lg font-extrabold">Értesítések</h2>
          <p className="text-sm text-muted-foreground">
            Az <Link to="/notifications">Értesítések</Link> oldalon mindet látod. Itt azt állítod, mit kapj meg, és hogy a telefonod is szóljon-e.
          </p>
        </div>
        <PushSettings vapidPublicKey={d.vapidPublicKey} />
        {d.kinds.length > 0 && (
          <div className="grid gap-4">
            {d.kinds.map((k) => (
              <KindSwitch key={k.kind} k={k} />
            ))}
          </div>
        )}
      </section>

      <div className="grid max-w-2xl gap-3 border-t pt-6">
        <p className="text-sm text-muted-foreground">
          Ha egy eszközödet elhagytad, vagy idegen gépen felejtetted bejelentkezve, lépj ki mindenhonnan.
        </p>
        <Form method="post" action="/logout">
          <Button type="submit" name="everywhere" value="1" variant="outline">
            Kilépés minden eszközön
          </Button>
        </Form>
      </div>
    </AppPage>
  );
}

import { data, Form, Link, useFetcher, useNavigation } from "react-router";

import type { Route } from "./+types/profile";
import { AppPage } from "~/components/app-page";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { ProfileFields } from "~/components/profile-fields";
import { RatingInfo } from "~/components/rating-info";
import { PushSettings } from "~/components/push-settings";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { hasGoogleLogin, updateProfile } from "~/lib/auth/accounts.server";
import { getActor } from "~/lib/auth/admin.server";
import { roleLabel } from "~/lib/auth/permissions";
import { initials, validateProfile, type ProfileErrors } from "~/lib/auth/rules";
import { requireUser } from "~/lib/auth/session.server";
import { channelEnabled, CHANNELS, isChannel, isEnabled, isNotificationKind, kindsFor, NOTIFICATION_KINDS } from "~/lib/notifications";
import { disabledKindsFor, setChannelEnabled, setKindEnabled, vapidPublicKey } from "~/lib/notifications.server";
import { formatPhone } from "~/lib/phone";
import { ratingFor, resolveLevel } from "~/lib/profile-level";
import { hasTakenPartInSeason } from "~/lib/profile-level.server";
import { hasPublicProfile } from "~/lib/profiles.server";
import { SITE_NAME } from "~/lib/site";

// The profile, inside the app shell (app.tsx): name, level, phone number, sex (#133)
// (the phone is never shown to anyone else on this page or any public page),
// notification settings, logout everywhere.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Profil – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  const [disabled, levelLocked, publicProfile] = await Promise.all([
    disabledKindsFor(user.id),
    hasTakenPartInSeason(user.id),
    hasPublicProfile(user.id),
  ]);
  return {
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    level: user.level,
    // Took part in a season: the level is read-only (#135).
    levelLocked,
    rating: ratingFor(user.level, user.elo),
    rated: user.elo !== null,
    // The public profile (#36), once the player has been in a published group.
    profilePath: publicProfile ? `/players/${user.id}` : null,
    phone: formatPhone(user.phone),
    sex: user.sex,
    initials: initials(user.name, user.email),
    google: await hasGoogleLogin(user.id),
    role: roleLabel(actor),
    leagues: actor.leagues.map((l) => l.name),
    vapidPublicKey: vapidPublicKey(),
    emailOn: channelEnabled(disabled, "email"),
    pushOn: channelEnabled(disabled, "push"),
    kinds: kindsFor(actor).map((kind) => ({ kind, ...NOTIFICATION_KINDS[kind], enabled: isEnabled(disabled, kind) })),
  };
}

// Saves the profile form, or switches email or push (#115) or one
// notification kind on or off (Értesítések section).
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  const form = await request.formData();
  if (form.get("intent") === "profile") {
    // A missing phone field must not clear the saved number.
    if (!form.has("phone")) return data({ saved: false, errors: {} as ProfileErrors }, { status: 400 });
    // A locked level can't be changed by any post, only the UI hides it (#135).
    const level = resolveLevel({
      locked: await hasTakenPartInSeason(user.id),
      stored: user.level,
      submitted: form.get("level"),
    });
    if (!level.ok) return data({ saved: false, errors: { level: level.error } as ProfileErrors }, { status: 400 });
    const result = validateProfile(
      { name: form.get("name"), level: level.level, phone: form.get("phone"), sex: form.get("sex") },
      { requireConsent: false },
    );
    if (!result.ok) return data({ saved: false, errors: result.errors }, { status: 400 });
    await updateProfile(user.id, result.value);
    return { saved: true, errors: {} as ProfileErrors };
  }
  const enabled = form.get("enabled") === "1";
  if (form.get("intent") === "channel") {
    const channel = form.get("channel");
    if (!isChannel(channel)) return data({ ok: false }, { status: 400 });
    await setChannelEnabled(user.id, channel, enabled);
    return { ok: true };
  }
  const kind = form.get("kind");
  if (!isNotificationKind(kind) || !kindsFor(actor).includes(kind)) return data({ ok: false }, { status: 400 });
  await setKindEnabled(user.id, kind, enabled);
  return { ok: true };
}

// One switch of the Értesítések section; `fields` say what it saves.
function SettingSwitch({
  id,
  label,
  description,
  enabled,
  fields,
}: {
  id: string;
  label: string;
  description: string;
  enabled: boolean;
  fields: Record<string, string>;
}) {
  const fetcher = useFetcher();
  // Optimistic: show the new value while it saves.
  const pending = fetcher.formData?.get("enabled");
  const checked = pending != null ? pending === "1" : enabled;
  return (
    <div className="flex items-start gap-3">
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={(on) => fetcher.submit({ ...fields, enabled: on ? "1" : "0" }, { method: "post" })}
        className="mt-0.5"
      />
      <div className="grid gap-0.5">
        <Label htmlFor={id}>{label}</Label>
        <p className="text-sm text-muted-foreground">{description}</p>
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
        {d.rating != null && <RatingInfo rating={d.rating} rated={d.rated} />}
        {d.profilePath && (
          <p className="text-sm">
            <Link to={d.profilePath} className="font-semibold underline">
              Nyilvános profilod
            </Link>
            <span className="text-muted-foreground">
              : ezt látja rólad bárki (az eredményeidet és az értékszámodat a liga indulása után).
            </span>
          </p>
        )}
        {!d.level && (
          <p role="status" className="rounded-md border border-dashed p-3 text-sm">
            Még nem adtad meg a szinted. Kell a jelentkezéshez.
          </p>
        )}
        <Form method="post" className="grid gap-5">
          <input type="hidden" name="intent" value="profile" />
          <ProfileFields errors={errors} values={{ name: d.name, level: d.level, phone: d.phone, sex: d.sex }} levelLocked={d.levelLocked} />
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
            Az <Link to="/notifications">Értesítések</Link> oldalon mindet látod, akármit állítasz itt. Itt azt választod, hogy
            e-mailben, push értesítésben vagy mindkettőben is szóljunk.
          </p>
        </div>
        <SettingSwitch
          id="channel-email"
          label={CHANNELS.email.label}
          description={CHANNELS.email.description}
          enabled={d.emailOn}
          fields={{ intent: "channel", channel: "email" }}
        />
        <PushSettings vapidPublicKey={d.vapidPublicKey} enabled={d.pushOn} />
        {d.kinds.length > 0 && (
          <div className="grid gap-4 border-t pt-4">
            <p className="text-sm text-muted-foreground">Szervezőként ezekről is szólunk:</p>
            {d.kinds.map((k) => (
              <SettingSwitch
                key={k.kind}
                id={`kind-${k.kind}`}
                label={k.label}
                description={k.description}
                enabled={k.enabled}
                fields={{ kind: k.kind }}
              />
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

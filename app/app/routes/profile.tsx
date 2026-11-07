import { data, Form, Link, redirect, useFetcher, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/profile";
import { AppPage } from "~/components/app-page";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { ProfileFields } from "~/components/profile-fields";
import { PlayerProfileView } from "~/components/player-profile-view";
import { PushSettings } from "~/components/push-settings";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { hasGoogleLogin, updateProfile } from "~/lib/auth/accounts.server";
import { getActor } from "~/lib/auth/admin.server";
import { roleLabel } from "~/lib/auth/permissions";
import { initials, validateProfile, type ProfileErrors } from "~/lib/auth/rules";
import { destroySession, requireUser } from "~/lib/auth/session.server";
import { DELETION_REFUSALS, OWN_DELETION_EFFECTS, ownDeletionNote } from "~/lib/account-deletion";
import { deleteOwnAccount, planOwnDeletion } from "~/lib/account-deletion.server";
import { channelEnabled, CHANNELS, isChannel, isEnabled, isNotificationKind, kindsFor, NOTIFICATION_KINDS } from "~/lib/notifications";
import { disabledKindsFor, setChannelEnabled, setKindEnabled, vapidPublicKey } from "~/lib/notifications.server";
import { formatPhone } from "~/lib/phone";
import { ratingFor, resolveLevel } from "~/lib/profile-level";
import { hasTakenPartInSeason } from "~/lib/profile-level.server";
import { playerProfile } from "~/lib/profiles.server";
import { SITE_NAME } from "~/lib/site";

// The profile, inside the app shell (app.tsx), in two tabs (D136):
// "Játékosprofil", what other players see (the summary, Élő-pont, pairs,
// matches), and "Beállításaim" (`?tab=settings`): name, level, phone number,
// sex (#133; the phone is never shown on a public page), notification
// settings, logout everywhere, deleting the account (#38).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Profil – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  const [disabled, levelLocked, profile, deletion] = await Promise.all([
    disabledKindsFor(user.id),
    hasTakenPartInSeason(user.id),
    playerProfile(user.id),
    planOwnDeletion(user.id),
  ]);
  return {
    // Fiók törlése (#38): what it would do now, or why it can't.
    deletion: deletion.ok
      ? { effect: `${OWN_DELETION_EFFECTS[deletion.mode]} ${ownDeletionNote(actor.leagues.length > 0)}` }
      : { refused: DELETION_REFUSALS[deletion.refusal] },
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    level: user.level,
    // Took part in a season: the level is read-only (#135).
    levelLocked,
    rating: ratingFor(user.level, user.elo),
    rated: user.elo !== null,
    // What other players see on /players/<id> (#36, D112), once the player
    // has been in a published group: the "Játékosprofil" tab (D136).
    profile,
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
  if (form.get("intent") === "delete-account") {
    // The same deletion as the Admin's (#152, D60); it ends every session
    // of the account, and this response clears this device's cookie.
    const result = await deleteOwnAccount(user.id);
    if (!result.ok) return data({ deleteError: result.error }, { status: 409 });
    return redirect("/?accountDeleted=1", { headers: { "Set-Cookie": await destroySession(request) } });
  }
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

// One block of the settings: a card with a heading (D136).
function Block({ id, title, description, children }: { id?: string; title: string; description?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card role="region" id={id} aria-label={title} className="scroll-mt-6">
      <CardHeader>
        <CardTitle className="font-display text-lg font-bold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className="grid gap-4">{children}</CardContent>
    </Card>
  );
}

export default function Profile({ loaderData: d, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const errors: ProfileErrors = (actionData && "errors" in actionData ? actionData.errors : null) ?? {};
  const saved = !!actionData && "saved" in actionData && actionData.saved;
  // The tab lives in the address (?tab=settings), so a link can open it.
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "settings" ? "settings" : "player";
  return (
    <AppPage
      title={
        <span className="flex items-center gap-3">
          <Avatar className="size-11">
            {d.imageUrl && <AvatarImage src={d.imageUrl} alt="" referrerPolicy="no-referrer" />}
            <AvatarFallback className="bg-nav-active-bg text-base font-bold text-nav-active">{d.initials}</AvatarFallback>
          </Avatar>
          {d.name}
        </span>
      }
      description={d.role}
    >
      <Tabs
        value={tab}
        onValueChange={(value) => setParams(value === "settings" ? { tab: "settings" } : {}, { replace: true, preventScrollReset: true })}
        className="gap-6"
      >
        <TabsList>
          <TabsTrigger value="player">Játékosprofil</TabsTrigger>
          <TabsTrigger value="settings">Beállításaim</TabsTrigger>
        </TabsList>

        <TabsContent value="player" className="grid gap-3">
          {d.profile && (
            <p className="text-sm text-muted-foreground">
              Ezt látják rólad a belépett játékosok a{" "}
              <Link to={`/players/${d.profile.player.id}`} className="font-medium">
                profilodon
              </Link>
              .
            </p>
          )}
          <PlayerProfileView profile={d.profile} own={{ rating: d.rating, rated: d.rated }} />
        </TabsContent>

        <TabsContent value="settings" className="grid max-w-2xl gap-6">
          <Block id="adatok" title="Adataid">
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
          </Block>

          <Block title="Fiók">
            <dl className="grid gap-4">
              <Row label="E-mail-cím">
                {d.email}
                <p className="text-sm text-muted-foreground">Az aktuális ellenfeleid is látják, hogy egyeztetni tudjatok. Nyilvános oldalon sosem jelenik meg.</p>
              </Row>
              <Row label="Belépés">{d.google ? "Google-lel vagy e-mailes kóddal" : "E-mailes kóddal"}</Row>
              {d.leagues.length > 0 && <Row label="Szervező itt">{d.leagues.join(", ")}</Row>}
            </dl>
            <div className="grid gap-2 border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Ha egy eszközödet elhagytad, vagy idegen gépen felejtetted bejelentkezve, lépj ki mindenhonnan.
              </p>
              <Form method="post" action="/logout">
                <Button type="submit" name="everywhere" value="1" variant="outline">
                  Kilépés minden eszközön
                </Button>
              </Form>
            </div>
          </Block>

          <Block
            id="ertesitesek"
            title="Értesítések"
            description={
              <>
                Az <Link to="/notifications">Értesítések</Link> oldalon mindet látod, akármit állítasz itt. Itt azt választod, hogy e-mailben,
                push értesítésben vagy mindkettőben is szóljunk.
              </>
            }
          >
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
                  <SettingSwitch key={k.kind} id={`kind-${k.kind}`} label={k.label} description={k.description} enabled={k.enabled} fields={{ kind: k.kind }} />
                ))}
              </div>
            )}
          </Block>

          <DeleteAccount deletion={d.deletion} />
        </TabsContent>
      </Tabs>
    </AppPage>
  );
}

// Fiók törlése (#38): the dialog says what happens, or why it can't now.
// A deletion that works lands on the home page, logged out.
function DeleteAccount({ deletion }: { deletion: { effect: string } | { refused: string } }) {
  const fetcher = useFetcher<typeof action>({ key: "account-delete" });
  const refused = "refused" in deletion ? deletion.refused : null;
  const error = fetcher.state === "idle" && fetcher.data && "deleteError" in fetcher.data ? fetcher.data.deleteError : null;
  return (
    <Block
      id="fiok-torlese"
      title="Fiók törlése"
      description="Ha már nem akarsz játszani, törölheted a fiókodat és az adataidat. A régi eredmények megmaradnak, de nem köthetők hozzád."
    >
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" className="justify-self-start" disabled={fetcher.state !== "idle"}>
            Fiók törlése
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{refused ? "Fiók törlése" : "Törlöd a fiókodat?"}</AlertDialogTitle>
            <AlertDialogDescription>{refused ?? ("effect" in deletion ? deletion.effect : "")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{refused ? "Rendben" : "Mégse"}</AlertDialogCancel>
            {!refused && (
              <AlertDialogAction variant="destructive" onClick={() => fetcher.submit({ intent: "delete-account" }, { method: "post" })}>
                Fiók törlése
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          {error}
        </p>
      )}
    </Block>
  );
}

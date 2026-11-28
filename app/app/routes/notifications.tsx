import { Bell, CalendarDays, Check, Clock, Settings, ShieldAlert, Trophy } from "lucide-react";
import { Form, Link, useFetcher } from "react-router";

import type { Route } from "./+types/notifications";
import { IconTile, Page, PageHeader, SectionLabel } from "~/components/blocks";
import { PushSettings } from "~/components/push-settings";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { requireUser } from "~/lib/auth/session.server";
import { formatDateTime, formatShortDate, formatWeekdayDate } from "~/lib/format";
import { CHANNELS, channelEnabled, noticeTone, timeAgo, type NoticeTone } from "~/lib/notifications";
import { disabledKindsFor, listNotifications, markAllRead, vapidPublicKey } from "~/lib/notifications.server";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// The user's notifications, newest first (direction A, #423, mockup P07):
// the unread ones by day, the rest under "Korábban", each with an icon
// coloured by what it asks (amber: waits on the player, blue: a time, green:
// done, red: a problem). Opening one (/notifications/<id>) marks it read.
// Wider screens add "Hogyan szóljunk?": the push switch of Profil.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Értesítések – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const now = new Date();
  // Relative times and day headings are worked out here, so the server and browser render the same.
  const items = (await listNotifications(user.id)).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    tone: noticeTone(n.kind),
    unread: !n.readAt,
    // "péntek, nov. 27." (formatWeekdayDate gives "nov. 27., péntek").
    day: formatWeekdayDate(n.createdAt).split(", ").reverse().join(", "),
    ago: timeAgo(n.createdAt, now, formatShortDate),
    at: formatDateTime(n.createdAt),
  }));
  const disabled = await disabledKindsFor(user.id);
  return { items, vapidPublicKey: vapidPublicKey(), email: channelEnabled(disabled, "email"), push: channelEnabled(disabled, "push") };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  await markAllRead(user.id);
  return { ok: true };
}

type Item = Route.ComponentProps["loaderData"]["items"][number];

const ICONS: Record<NoticeTone, React.ReactNode> = {
  warning: <Clock />,
  info: <CalendarDays />,
  success: <Check />,
  danger: <ShieldAlert />,
  neutral: <Trophy />,
};

function NotificationRow({ n }: { n: Item }) {
  return (
    <li>
      <Link
        to={`/notifications/${n.id}`}
        className={cn(
          "flex items-center gap-3.5 px-4 py-3.5 text-foreground no-underline transition-colors md:px-5",
          n.unread ? "bg-surface-2 hover:bg-surface-3" : "hover:bg-surface-2/60",
        )}
      >
        <IconTile tone={n.tone}>{ICONS[n.tone] ?? <Bell />}</IconTile>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className={cn("leading-snug", n.unread && "font-bold")}>{n.title}</span>
          <span className="line-clamp-2 text-caption text-muted-foreground">{n.body}</span>
        </span>
        <time title={n.at} className="shrink-0 text-xs text-muted-foreground">
          {n.ago}
        </time>
        {n.unread && <span aria-label="Olvasatlan" className="size-2.5 shrink-0 rounded-full bg-ball" />}
      </Link>
    </li>
  );
}

function Group({ title, items }: { title: string; items: Item[] }) {
  if (items.length === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2.5">
      <SectionLabel>{title}</SectionLabel>
      <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl bg-surface p-0 [&>li+li]:border-t [&>li+li]:border-hairline">
        {items.map((n) => (
          <NotificationRow key={n.id} n={n} />
        ))}
      </ul>
    </section>
  );
}

// The email switch, saved by Profil's own action (the same setting).
function EmailSwitch({ enabled }: { enabled: boolean }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("enabled");
  const on = pending != null ? pending === "1" : enabled;
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="grid gap-0.5">
        <Label htmlFor="channel-email">E-mail</Label>
        <p className="text-caption text-muted-foreground">{CHANNELS.email.description}</p>
      </div>
      <Switch
        id="channel-email"
        checked={on}
        onCheckedChange={(next) => fetcher.submit({ intent: "channel", channel: "email", enabled: next ? "1" : "0" }, { method: "post", action: "/profile" })}
      />
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export default function Notifications({ loaderData: d }: Route.ComponentProps) {
  const unread = d.items.filter((n) => n.unread);
  // The unread ones by day, newest first; then everything read.
  const days = [...new Set(unread.map((n) => n.day))];
  const settings = "/profile?tab=settings#ertesitesek";
  return (
    <Page>
      <PageHeader
        eyebrow={unread.length > 0 ? <span className="font-bold text-warning">{unread.length} olvasatlan</span> : undefined}
        title="Értesítések"
        aside={
          unread.length > 0 && (
            <Form method="post">
              <Button type="submit" variant="secondary" size="xl" className="rounded-full">
                Mind olvasott
              </Button>
            </Form>
          )
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <div className="flex flex-col gap-6">
          {d.items.length === 0 ? (
            <p className="m-0 text-muted-foreground">Még nincs értesítésed.</p>
          ) : (
            <>
              {days.map((day) => (
                <Group key={day} title={capitalize(day)} items={unread.filter((n) => n.day === day)} />
              ))}
              <Group title="Korábban" items={d.items.filter((n) => !n.unread)} />
            </>
          )}
          <Link to={settings} className="flex min-h-11 w-fit items-center gap-2 text-sm font-bold text-ball no-underline hover:underline lg:hidden">
            <Settings aria-hidden className="size-[18px]" />
            E-mail és push beállítása
          </Link>
        </div>
        <section aria-labelledby="hogyan-szoljunk" className="hidden flex-col gap-4 rounded-2xl bg-surface p-5 lg:flex">
          <h2 id="hogyan-szoljunk" className="m-0 text-[17px] font-bold">
            Hogyan szóljunk?
          </h2>
          <EmailSwitch enabled={d.email} />
          <PushSettings vapidPublicKey={d.vapidPublicKey} enabled={d.push} compact />
          <Link to={settings} className="flex min-h-11 w-fit items-center text-sm font-bold text-ball no-underline hover:underline">
            Minden beállítás a Profilban
          </Link>
        </section>
      </div>
    </Page>
  );
}

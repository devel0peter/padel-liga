import { Bell } from "lucide-react";
import { Form, Link } from "react-router";

import type { Route } from "./+types/notifications";
import { AppPage } from "~/components/app-page";
import { Button } from "~/components/ui/button";
import { requireUser } from "~/lib/auth/session.server";
import { formatDateTime, formatShortDate } from "~/lib/format";
import { timeAgo } from "~/lib/notifications";
import { listNotifications, markAllRead } from "~/lib/notifications.server";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// The user's notifications, newest first: unread ones under "Új", the rest
// under "Korábbiak". Opening one (/notifications/<id>) marks it read.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Értesítések – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const now = new Date();
  // Relative times are worked out here, so the server and browser render the same.
  const items = (await listNotifications(user.id)).map((n) => ({
    id: n.id,
    title: n.title,
    body: n.body,
    unread: !n.readAt,
    ago: timeAgo(n.createdAt, now, formatShortDate),
    at: formatDateTime(n.createdAt),
  }));
  return { items };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  await markAllRead(user.id);
  return { ok: true };
}

type Item = Route.ComponentProps["loaderData"]["items"][number];

function NotificationRow({ n }: { n: Item }) {
  return (
    <li>
      <Link
        to={`/notifications/${n.id}`}
        className={cn(
          "flex items-start gap-3 rounded-lg px-3 py-3 text-foreground no-underline hover:bg-muted",
          n.unread && "bg-nav-active-bg/60",
        )}
      >
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-nav-active-bg text-nav-active">
          <Bell className="size-4" />
        </span>
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className={cn("leading-snug", n.unread && "font-semibold")}>{n.title}</span>
          <span className="text-sm text-muted-foreground">{n.body}</span>
          <time title={n.at} className={cn("text-xs", n.unread ? "font-semibold text-nav-active" : "text-muted-foreground")}>
            {n.ago}
          </time>
        </span>
        {n.unread && <span aria-label="Olvasatlan" className="mt-2 size-2.5 shrink-0 rounded-full bg-nav-active" />}
      </Link>
    </li>
  );
}

function Section({ title, items }: { title: string; items: Item[] }) {
  if (items.length === 0) return null;
  return (
    <section className="grid gap-1">
      <h2 className="px-3 text-sm font-semibold text-muted-foreground">{title}</h2>
      <ul className="grid gap-1">
        {items.map((n) => (
          <NotificationRow key={n.id} n={n} />
        ))}
      </ul>
    </section>
  );
}

export default function Notifications({ loaderData: { items } }: Route.ComponentProps) {
  const unread = items.filter((n) => n.unread);
  return (
    <AppPage
      title="Értesítések"
      description={
        <>
          Itt mind megvan. Hogy e-mailben és push értesítésben is szóljunk-e, a{" "}
          <Link to="/profile#ertesitesek">profilodon</Link> állítod be.
        </>
      }
      actions={
        unread.length > 0 && (
          <Form method="post">
            <Button type="submit" variant="outline" size="sm">
              Mind olvasott
            </Button>
          </Form>
        )
      }
    >
      {items.length === 0 ? (
        <p className="text-muted-foreground">Még nincs értesítésed.</p>
      ) : (
        <div className="grid max-w-2xl gap-6 -mx-3">
          <Section title="Új" items={unread} />
          <Section title="Korábbiak" items={items.filter((n) => !n.unread)} />
        </div>
      )}
    </AppPage>
  );
}

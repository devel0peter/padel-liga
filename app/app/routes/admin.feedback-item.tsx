import { data, Form, useNavigation } from "react-router";

import type { Route } from "./+types/admin.feedback-item";
import { AppPage } from "~/components/app-page";
import { PersonLink } from "~/components/person-link";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { requirePermission } from "~/lib/auth/admin.server";
import { DEVICE_LABELS, KIND_LABELS, VISITOR_NAME } from "~/lib/feedback";
import { feedbackItem, setFeedbackDone } from "~/lib/feedback.server";
import { formatDateTime } from "~/lib/format";
import { SITE_NAME } from "~/lib/site";

// One feedback message for the Admin (#241, spec 19): the full text, the
// rating, the context and the sender (name only, never an email or phone),
// and "Kész" / "Újranyitom" (audited, D91).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Visszajelzés – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

function parseId(value: string | undefined): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw data("Nincs ilyen visszajelzés.", { status: 404 });
  return id;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "feedback.view" });
  const item = await feedbackItem(parseId(params.id));
  if (!item) throw data("Nincs ilyen visszajelzés.", { status: 404 });
  return { item };
}

export async function action({ request, params }: Route.ActionArgs) {
  const actor = await requirePermission(request, { kind: "feedback.view" });
  const id = parseId(params.id);
  const intent = (await request.formData()).get("intent");
  if (intent !== "done" && intent !== "reopen") throw data("Ismeretlen művelet.", { status: 400 });
  await setFeedbackDone(id, intent === "done", actor.id);
  return { ok: true };
}

function Stars({ rating }: { rating: number }) {
  return (
    <span role="img" aria-label={`${rating} csillag az 5-ből`} className="text-xl tracking-wider text-amber-500">
      {"★".repeat(rating)}
      <span className="text-muted-foreground/40">{"★".repeat(5 - rating)}</span>
    </span>
  );
}

const who = (p: { id: string; name: string } | null) => (p ? <PersonLink id={p.id} name={p.name} /> : "?");

export default function AdminFeedbackItem({ loaderData }: Route.ComponentProps) {
  const { item } = loaderData;
  const busy = useNavigation().state !== "idle";
  const context: [string, React.ReactNode][] = [
    ["Küldő", item.sender ? <PersonLink id={item.sender.id} name={item.sender.name} /> : VISITOR_NAME],
    ["Időpont", formatDateTime(new Date(item.createdAt))],
    ["Oldal", item.page || "–"],
    ["Eszköz", DEVICE_LABELS[item.device]],
    ["Böngésző", item.browser],
    ["Verzió", item.appVersion],
  ];
  return (
    <AppPage
      title={`${KIND_LABELS[item.kind]} #${item.id}`}
      back={{ to: "/admin/feedback", label: "Visszajelzések" }}
      actions={
        <Form method="post">
          {item.done ? (
            <Button type="submit" name="intent" value="reopen" variant="outline" disabled={busy}>
              Újranyitom
            </Button>
          ) : (
            <Button type="submit" name="intent" value="done" disabled={busy}>
              Kész
            </Button>
          )}
        </Form>
      }
    >
      <section aria-label="Üzenet" className="grid max-w-3xl gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.kind === "bug" ? "destructive" : "secondary"}>{KIND_LABELS[item.kind]}</Badge>
          <Badge variant={item.done ? "outline" : "default"}>{item.done ? "Kész" : "Nyitott"}</Badge>
        </div>
        {item.rating !== null && <Stars rating={item.rating} />}
        <p className="rounded-lg border p-4 break-words whitespace-pre-wrap">
          {item.message || <span className="text-muted-foreground">(nincs megjegyzés)</span>}
        </p>
      </section>
      <section aria-label="Adatok" className="max-w-3xl">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {context.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="min-w-0 break-words">{value}</dd>
            </div>
          ))}
          {item.doneAt && (
            <div className="contents">
              <dt className="text-muted-foreground">Kész</dt>
              <dd>
                {formatDateTime(new Date(item.doneAt))}, {who(item.doneBy)}
              </dd>
            </div>
          )}
          {item.reopenedAt && (
            <div className="contents">
              <dt className="text-muted-foreground">Újranyitva</dt>
              <dd>
                {formatDateTime(new Date(item.reopenedAt))}, {who(item.reopenedBy)}
              </dd>
            </div>
          )}
        </dl>
      </section>
    </AppPage>
  );
}

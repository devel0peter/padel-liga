import { data, Form, Link, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.league-disputes";
import { ListCard, ListRow, Page, PageHeader, SectionLabel, Segmented, StatusPill } from "~/components/blocks";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { closedDecisions, openDecisions } from "~/lib/organizer-decisions.server";
import { approvePartnerChange, rejectPartnerChange, undoPartnerChange } from "~/lib/partner-changes.server";
import { SITE_NAME } from "~/lib/site";

// Döntések (#434): replaces Viták. Lists every open decision waiting on the
// organizer (disputed results, no-show reports, permanent partner changes)
// oldest first, plus Lezárt (last 14 days and any approved partner change that
// has not started yet, with Visszavonás).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Döntések – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  const [open, closed] = await Promise.all([openDecisions(league.id, league.slug), closedDecisions(league.id, league.slug)]);
  return { league, open, closed };
}

export async function action({ request, params }: Route.ActionArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const changeId = Number(form.get("changeId"));
  if (!Number.isInteger(changeId) || changeId <= 0) return data({ ok: false, error: "Érvénytelen kérés." }, { status: 400 });

  if (intent === "approve-change") {
    const res = await approvePartnerChange(actor.id, league.id, changeId);
    return res.ok ? { ok: true, notice: "Partnercsere jóváhagyva." } : data({ ok: false, error: res.error }, { status: 400 });
  }
  if (intent === "reject-change") {
    const res = await rejectPartnerChange(actor.id, league.id, changeId, String(form.get("reason") ?? ""));
    return res.ok ? { ok: true, notice: "Partnercsere elutasítva." } : data({ ok: false, error: res.error }, { status: 400 });
  }
  if (intent === "undo-change") {
    const res = await undoPartnerChange(actor.id, league.id, changeId);
    return res.ok ? { ok: true, notice: "Partnercsere visszavonva." } : data({ ok: false, error: res.error }, { status: 400 });
  }
  return data({ ok: false, error: "Ismeretlen művelet." }, { status: 400 });
}

export default function LeagueDecisions({ loaderData, actionData }: Route.ComponentProps) {
  const { league, open, closed } = loaderData;
  const [search] = useSearchParams();
  const tab = search.get("tab") === "closed" ? "closed" : "open";
  const busy = useNavigation().state !== "idle";
  const base = `/admin/leagues/${league.slug}/disputes`;

  return (
    <Page>
      <PageHeader eyebrow={league.name} title="Döntések" />

      <Segmented
        label="Döntések szűrő"
        value={tab}
        options={[
          { value: "open", label: open.length > 0 ? `Nyitott (${open.length})` : "Nyitott", to: `${base}?tab=open` },
          { value: "closed", label: `Lezárt (${closed.length})`, to: `${base}?tab=closed` },
        ]}
      />

      {actionData && "error" in actionData && actionData.error && (
        <p role="alert" className="rounded-xl bg-danger-tint px-4 py-3 text-sm font-semibold text-danger">
          {actionData.error}
        </p>
      )}
      {actionData && "notice" in actionData && actionData.notice && (
        <p role="status" className="rounded-xl bg-success-tint px-4 py-3 text-sm font-semibold text-success">
          {actionData.notice}
        </p>
      )}

      {tab === "open" ? (
        open.length === 0 ? (
          <div className="rounded-2xl bg-surface p-6 text-center text-sm text-muted-foreground">
            Nincs nyitott döntés. Minden rendben.
          </div>
        ) : (
          <div className="grid gap-3">
            <SectionLabel tone="warning">Legrégebbi elöl · {open.length}</SectionLabel>
            {open.map((item) => {
              if (item.kind === "partner_change") {
                return (
                  <div key={item.id} className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <StatusPill tone="warning">Partnercsere</StatusPill>
                      <span className="text-caption text-muted-foreground">{formatDateTime(item.waitingSince)}</span>
                    </div>
                    <p className="font-semibold">
                      {item.stayingName}: {item.leavingName} helyett {item.partnerName}
                    </p>
                    <p className="text-caption text-muted-foreground">
                      Ebben a szezonban partnercsere: {item.stayingName} ({item.counts.staying}), {item.partnerName} ({item.counts.partner})
                    </p>
                    <Form method="post" className="grid gap-2">
                      <input type="hidden" name="changeId" value={item.changeId} />
                      <Input name="reason" placeholder="Indoklás elutasítás esetén (opcionális)" className="max-w-md" />
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" size="xl" name="intent" value="approve-change" disabled={busy}>
                          Jóváhagyom
                        </Button>
                        <Button type="submit" size="xl" variant="secondary" name="intent" value="reject-change" disabled={busy}>
                          Elutasítom
                        </Button>
                      </div>
                    </Form>
                  </div>
                );
              }
              return (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface p-4 sm:p-5">
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusPill tone={item.kind === "dispute" ? "danger" : "warning"}>
                        {item.kind === "dispute" ? "Vitatott eredmény" : "Nem jöttek el"}
                      </StatusPill>
                      <span className="text-caption text-muted-foreground">
                        {item.seasonName} · {item.phase}. kör · {item.groupNumber}. csoport
                      </span>
                    </div>
                    <p className="font-semibold">{item.pairsLabel}</p>
                    <p className="text-caption text-muted-foreground">Várakozik: {formatDateTime(item.waitingSince)}</p>
                  </div>
                  <Button asChild size="xl" variant="secondary">
                    <Link to={item.url} className="no-underline">
                      Döntök
                    </Link>
                  </Button>
                </div>
              );
            })}
          </div>
        )
      ) : closed.length === 0 ? (
        <div className="rounded-2xl bg-surface p-6 text-center text-sm text-muted-foreground">
          Az elmúlt 14 napban nem volt lezárt döntés.
        </div>
      ) : (
        <ListCard>
          {closed.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
              <div className="grid gap-0.5">
                <p className="font-medium">{item.title}</p>
                <p className="text-caption text-muted-foreground">
                  {item.outcome}
                  {item.decidedBy ? ` · ${item.decidedBy}` : ""} · {formatDateTime(item.decidedAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {item.undoChangeId && (
                  <Form method="post">
                    <input type="hidden" name="intent" value="undo-change" />
                    <input type="hidden" name="changeId" value={item.undoChangeId} />
                    <Button type="submit" size="sm" variant="secondary" disabled={busy}>
                      Visszavonás
                    </Button>
                  </Form>
                )}
                {item.url && (
                  <Link to={item.url} className="text-sm font-semibold text-foreground underline">
                    Megnyitás
                  </Link>
                )}
              </div>
            </div>
          ))}
        </ListCard>
      )}
    </Page>
  );
}

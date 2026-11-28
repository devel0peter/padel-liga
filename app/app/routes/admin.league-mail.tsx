import { data, Form, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.league-mail";
import { Page, PageHeader, SectionLabel, Segmented } from "~/components/blocks";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { listBroadcasts, outboxLog } from "~/lib/email/outbox.server";
import { kindLabel } from "~/lib/email/outbox-view";
import { formatDateTime } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { leagueBroadcastAudience, leagueBroadcastCap, sendLeagueBroadcast } from "~/lib/organizer-broadcast.server";
import { SITE_NAME } from "~/lib/site";

// Levelek (#387 Körlevél, #388 Kimenő levelek) for a league's Szervező and Admin.
// Never exposes any player's email address.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Levelek – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  const url = new URL(request.url);
  const tab = url.searchParams.get("tab") === "outbox" ? "outbox" : "broadcast";
  const idsParam = url.searchParams.get("ids") ?? "";
  const selectedIds = idsParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const audienceLabel = url.searchParams.get("audience") || league.name;

  const [cap, audience, sentBroadcasts, outbox] = await Promise.all([
    leagueBroadcastCap(league.id),
    leagueBroadcastAudience(league.id, selectedIds.length > 0 ? selectedIds : undefined),
    listBroadcasts(league.id),
    tab === "outbox" ? outboxLog(league.id) : Promise.resolve([]),
  ]);

  return {
    league,
    tab,
    cap,
    // Names only: never send email addresses to a Szervező (#387).
    recipientNames: audience.map((a) => a.name || "Névtelen"),
    recipientCount: audience.length,
    selectedIds,
    audienceLabel,
    sentBroadcasts,
    outbox,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const form = await request.formData();
  const ids = String(form.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const res = await sendLeagueBroadcast({
    leagueId: league.id,
    subject: String(form.get("subject") ?? ""),
    body: String(form.get("body") ?? ""),
    audienceLabel: String(form.get("audienceLabel") ?? league.name),
    userIds: ids.length > 0 ? ids : undefined,
    actor: { id: actor.id, email: actor.email },
  });
  return res.ok
    ? { ok: true, notice: `Körlevél sorba állítva ${res.count} játékosnak.` }
    : data({ ok: false, error: res.error }, { status: 400 });
}

export default function LeagueMail({ loaderData, actionData }: Route.ComponentProps) {
  const { league, tab, cap, recipientNames, recipientCount, selectedIds, audienceLabel, sentBroadcasts, outbox } = loaderData;
  const busy = useNavigation().state !== "idle";
  const base = `/admin/leagues/${league.slug}/mail`;

  return (
    <Page>
      <PageHeader eyebrow={league.name} title="Levelek" />
      <Segmented
        label="Levelek fülek"
        value={tab}
        options={[
          { value: "broadcast", label: "Körlevél", to: `${base}?tab=broadcast` },
          { value: "outbox", label: "Kimenő levelek", to: `${base}?tab=outbox` },
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

      {tab === "broadcast" ? (
        <div className="grid gap-5">
          <section className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>Új körlevél</SectionLabel>
            <p className="text-caption text-muted-foreground">
              Naponta legfeljebb 1 körlevelet küldhetsz a saját ligád játékosainak. A feladónév és a válaszcím a liga kapcsolattartójáé.
            </p>
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              <p className="font-semibold">
                Címzettek: {audienceLabel} ({recipientCount} fő)
              </p>
              {recipientNames.length > 0 && (
                <p className="mt-1 text-caption text-muted-foreground">
                  {recipientNames.slice(0, 15).join(", ")}
                  {recipientNames.length > 15 ? ` és még ${recipientNames.length - 15} fő` : ""}
                </p>
              )}
            </div>
            {!cap.allowed ? (
              <p className="rounded-xl bg-warning-tint px-4 py-3 text-sm font-semibold text-warning">{cap.message}</p>
            ) : (
              <Form method="post" className="grid max-w-2xl gap-3">
                <input type="hidden" name="ids" value={selectedIds.join(",")} />
                <input type="hidden" name="audienceLabel" value={audienceLabel} />
                <div className="grid gap-1">
                  <Label htmlFor="bc-subject">Tárgy</Label>
                  <Input id="bc-subject" name="subject" required placeholder="Pl. Hétvégi játéknap – emlékeztető" />
                </div>
                <div className="grid gap-1">
                  <Label htmlFor="bc-body">Üzenet</Label>
                  <Textarea id="bc-body" name="body" required rows={6} placeholder="Sziasztok! ..." />
                </div>
                <div>
                  <Button type="submit" size="xl" disabled={busy || recipientCount === 0}>
                    Körlevél küldése ({recipientCount} fő)
                  </Button>
                </div>
              </Form>
            )}
          </section>

          <section className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>Korábbi körlevelek ({sentBroadcasts.length})</SectionLabel>
            {sentBroadcasts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Még nem ment ki körlevél ebben a ligában.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mikor</TableHead>
                    <TableHead>Tárgy</TableHead>
                    <TableHead>Címzettek</TableHead>
                    <TableHead>Kiment / Vár / Hiba</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sentBroadcasts.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(b.createdAt)}</TableCell>
                      <TableCell className="font-medium">{b.subject}</TableCell>
                      <TableCell>{b.audience}</TableCell>
                      <TableCell>
                        {b.sent} / {b.pending} / {b.failed}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      ) : (
        <div className="grid gap-5">
          <section className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>Kimenő levelek típus szerint</SectionLabel>
            {outbox.length === 0 ? (
              <p className="text-sm text-muted-foreground">Még nincs rögzített kimenő levél ebben a ligában.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Típus</TableHead>
                    <TableHead>Vár</TableHead>
                    <TableHead>Kiment</TableHead>
                    <TableHead>Hiba</TableHead>
                    <TableHead>Legutóbbi hiba</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outbox.map((row) => (
                    <TableRow key={row.kind}>
                      <TableCell className="font-medium">{kindLabel(row.kind)}</TableCell>
                      <TableCell>{row.waiting}</TableCell>
                      <TableCell>{row.sent}</TableCell>
                      <TableCell>{row.failed}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{row.lastError?.reason ?? "–"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>Körlevelek állapota</SectionLabel>
            {sentBroadcasts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Még nincs körlevél.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tárgy</TableHead>
                    <TableHead>Kiment</TableHead>
                    <TableHead>Vár</TableHead>
                    <TableHead>Hiba</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sentBroadcasts.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell className="font-medium">{b.subject}</TableCell>
                      <TableCell>{b.sent}</TableCell>
                      <TableCell>{b.pending}</TableCell>
                      <TableCell>{b.failed}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        </div>
      )}
    </Page>
  );
}

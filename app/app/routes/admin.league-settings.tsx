import { data, Form, Link, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.league-settings";
import { Page, PageHeader, SectionLabel, Segmented } from "~/components/blocks";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { actionLabel } from "~/lib/audit";
import { requirePermission } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import { clubsAction, clubsData, clubsScope } from "~/lib/clubs-page.server";
import { formatDateTime } from "~/lib/format";
import { parseMinEntries } from "~/lib/seasons";
import { LOCAL_RULES_MAX } from "~/lib/leagues";
import { getLeagueSettings, organizersByLeague, updateLeagueContact, updateLeagueLocalRules } from "~/lib/leagues.server";
import { leagueAuditLog } from "~/lib/organizer-log.server";
import { SITUATION_LABELS, SITUATIONS } from "~/lib/reminders";
import { reminderOverview, setReminders } from "~/lib/reminders.server";
import { setMinEntries } from "~/lib/season-start.server";
import { SITE_NAME } from "~/lib/site";

// Beállítások (#436): Liga (city, organizers, minimum entries, league contact
// #384, local rules #390), Klubok, Emlékeztetők, Napló (#389).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Beállítások – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

type Tab = "league" | "clubs" | "reminders" | "log";

function parseTab(raw: string | null, canClubs: boolean): Tab {
  if (raw === "clubs" && canClubs) return "clubs";
  if (raw === "reminders") return "reminders";
  if (raw === "log") return "log";
  return "league";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const settings = await getLeagueSettings(params.league);
  if (!settings) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: settings.slug });
  const canClubs = can(actor, { kind: "clubs.manage", city: settings.city });
  const url = new URL(request.url);
  const tab = parseTab(url.searchParams.get("tab"), canClubs);

  const [orgMap, clubs, reminders, log] = await Promise.all([
    tab === "league" ? organizersByLeague() : Promise.resolve(null),
    tab === "clubs" && canClubs ? clubsData(await clubsScope(request, settings.slug)) : Promise.resolve(null),
    tab === "reminders" ? reminderOverview({ id: settings.id, slug: settings.slug, city: settings.city, name: settings.name }) : Promise.resolve(null),
    tab === "log"
      ? leagueAuditLog(settings.id, settings.city, {
          action: url.searchParams.get("action") || undefined,
          actorId: url.searchParams.get("actor") || undefined,
        })
      : Promise.resolve(null),
  ]);

  return {
    settings,
    canClubs,
    tab,
    organizers: orgMap?.get(settings.id)?.active ?? [],
    clubs,
    reminders,
    log,
    filters: {
      action: url.searchParams.get("action") ?? "",
      actor: url.searchParams.get("actor") ?? "",
    },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const settings = await getLeagueSettings(params.league);
  if (!settings) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: settings.slug });
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "contact") {
    const res = await updateLeagueContact(
      settings.id,
      {
        name: String(form.get("contactName") ?? ""),
        email: String(form.get("contactEmail") ?? ""),
        phone: String(form.get("contactPhone") ?? ""),
      },
      actor.id,
    );
    return res.ok ? { ok: true, notice: "Kapcsolattartó mentve." } : data({ ok: false, error: res.error }, { status: 400 });
  }
  if (intent === "local-rules") {
    const res = await updateLeagueLocalRules(settings.id, String(form.get("localRules") ?? ""), actor.id);
    return res.ok ? { ok: true, notice: "Helyi kiegészítés mentve." } : data({ ok: false, error: res.error }, { status: 400 });
  }
  if (intent === "min-entries") {
    const parsed = parseMinEntries(form.get("minEntries"));
    if (!parsed.ok) return data({ ok: false, error: parsed.error }, { status: 400 });
    const res = await setMinEntries(actor, settings.id, parsed.value);
    return res.ok ? { ok: true, notice: "Minimum nevezés mentve." } : data({ ok: false, error: res.error }, { status: 400 });
  }
  if (intent === "reminders") {
    const on = form.get("on") === "1";
    await setReminders(actor.id, { id: settings.id, slug: settings.slug, city: settings.city, name: settings.name }, on);
    return { ok: true, notice: on ? "Automatikus emlékeztetők bekapcsolva." : "Automatikus emlékeztetők kikapcsolva." };
  }
  if (intent.startsWith("club:")) {
    return clubsAction(request, await clubsScope(request, settings.slug));
  }
  return data({ ok: false, error: "Ismeretlen művelet." }, { status: 400 });
}

export default function LeagueSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { settings, canClubs, tab, organizers, clubs, reminders, log, filters } = loaderData;
  const busy = useNavigation().state !== "idle";
  const base = `/admin/leagues/${settings.slug}/settings`;

  const options = [
    { value: "league", label: "Liga", to: `${base}?tab=league` },
    ...(canClubs ? [{ value: "clubs", label: "Klubok", to: `${base}?tab=clubs` }] : []),
    { value: "reminders", label: "Emlékeztetők", to: `${base}?tab=reminders` },
    { value: "log", label: "Napló", to: `${base}?tab=log` },
  ];

  return (
    <Page>
      <PageHeader eyebrow={settings.name} title="Beállítások" />
      <Segmented label="Beállítások fülek" value={tab} options={options} />

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

      {tab === "league" && (
        <div className="grid gap-5">
          <section className="grid gap-2 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>Alapadatok</SectionLabel>
            <p className="text-sm">
              <span className="text-muted-foreground">Város:</span> <strong>{settings.city}</strong>
            </p>
            <p className="text-sm">
              <span className="text-muted-foreground">Szervezők:</span>{" "}
              {organizers.length > 0 ? organizers.map((o) => o.name || "Névtelen").join(", ") : "Nincs hozzárendelve"}
            </p>
          </section>

          <section className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>Kapcsolattartó</SectionLabel>
            <p className="text-caption text-muted-foreground">
              A liga leveleinek feladóneve és válaszcíme (Reply-To), valamint ez látszik a játékosok oldalain.
            </p>
            <Form method="post" className="grid max-w-lg gap-3">
              <input type="hidden" name="intent" value="contact" />
              <div className="grid gap-1">
                <Label htmlFor="contactName">Feladónév / kapcsolattartó neve</Label>
                <Input id="contactName" name="contactName" defaultValue={settings.contactName ?? ""} placeholder="pl. Kovács Péter, Győri liga" required={settings.cityListed} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="contactEmail">Válaszcím (e-mail)</Label>
                <Input id="contactEmail" name="contactEmail" type="email" defaultValue={settings.contactEmail ?? ""} placeholder="szervezo@pelda.hu" required={settings.cityListed} />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="contactPhone">Telefonszám (opcionális)</Label>
                <Input id="contactPhone" name="contactPhone" defaultValue={settings.contactPhone ?? ""} placeholder="+36 30 ..." />
              </div>
              <div>
                <Button type="submit" size="xl" disabled={busy}>
                  Kapcsolattartó mentése
                </Button>
              </div>
            </Form>
          </section>

          <section className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>Helyi szabályzat-kiegészítés</SectionLabel>
            <p className="text-caption text-muted-foreground">
              A közös szabályzat alatt jelenik meg a ligád játékosainak (klubok, díjak, támogatók, helyi szokások). A közös szabályokat nem írhatja felül.
            </p>
            <Form method="post" className="grid max-w-2xl gap-3">
              <input type="hidden" name="intent" value="local-rules" />
              <Textarea
                name="localRules"
                defaultValue={settings.localRules ?? ""}
                rows={6}
                maxLength={LOCAL_RULES_MAX}
                placeholder="Pl. Ajánlott klubok, helyi támogatók, nyeremények, linkek..."
              />
              <div>
                <Button type="submit" size="xl" variant="secondary" disabled={busy}>
                  Kiegészítés mentése
                </Button>
              </div>
            </Form>
          </section>

          <section className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
            <SectionLabel>Első szezon minimum nevezés</SectionLabel>
            <Form method="post" className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="intent" value="min-entries" />
              <div className="grid gap-1">
                <Label htmlFor="minEntries">Minimum párok száma</Label>
                <Input id="minEntries" name="minEntries" type="number" min={4} max={200} defaultValue={settings.minEntries} className="w-32" />
              </div>
              <Button type="submit" size="xl" variant="secondary" disabled={busy}>
                Mentés
              </Button>
            </Form>
          </section>
        </div>
      )}

      {tab === "clubs" && clubs && (
        <section className="grid gap-3 rounded-2xl bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionLabel>Klubok ({clubs.clubs.length})</SectionLabel>
            <Link to={`/admin/leagues/${settings.slug}/clubs?full=1`} className="text-sm font-semibold underline">
              Klubok szerkesztése
            </Link>
          </div>
          {clubs.clubs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Még nincs felvett klub ebben a városban.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {clubs.clubs.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5">
                  <span className="font-medium">{c.name}</span>
                  <span className="text-caption text-muted-foreground">{c.active ? "Aktív" : "Inaktív"}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "reminders" && reminders && (
        <section className="grid gap-4 rounded-2xl bg-surface p-4 sm:p-5">
          <SectionLabel>Automatikus emlékeztetők elakadtaknak</SectionLabel>
          <Form method="post" className="flex items-center justify-between gap-4">
            <input type="hidden" name="intent" value="reminders" />
            <input type="hidden" name="on" value={reminders.on ? "0" : "1"} />
            <div className="grid gap-0.5">
              <p className="font-medium">{reminders.on ? "Bekapcsolva" : "Kikapcsolva"}</p>
              <p className="text-caption text-muted-foreground">
                Automatikus e-mail emlékeztetők azoknak, akik elakadtak a nevezés előtt.
              </p>
            </div>
            <Button type="submit" size="xl" variant={reminders.on ? "secondary" : "default"} disabled={busy}>
              {reminders.on ? "Kikapcsolom" : "Bekapcsolom"}
            </Button>
          </Form>
          <div className="grid gap-2 text-sm">
            {SITUATIONS.map((s) => (
              <div key={s} className="flex items-center justify-between rounded-xl bg-surface-2 px-3.5 py-2.5">
                <span>{SITUATION_LABELS[s]}</span>
                <span className="font-semibold">{reminders.due[s] ?? 0} fő</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {tab === "log" && log && (
        <section className="grid gap-4 rounded-2xl bg-surface p-4 sm:p-5">
          <SectionLabel>Liga napló ({log.entries.length})</SectionLabel>
          <Form method="get" className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="tab" value="log" />
            <div className="grid gap-1">
              <Label htmlFor="log-action">Művelet</Label>
              <select
                id="log-action"
                name="action"
                defaultValue={filters.action}
                className="h-10 rounded-lg border border-input bg-surface-2 px-3 text-sm"
              >
                <option value="">Minden művelet</option>
                {log.actions.map((a) => (
                  <option key={a} value={a}>
                    {actionLabel(a)}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="log-actor">Ki</Label>
              <select
                id="log-actor"
                name="actor"
                defaultValue={filters.actor}
                className="h-10 rounded-lg border border-input bg-surface-2 px-3 text-sm"
              >
                <option value="">Mindenki</option>
                {log.actors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <Button type="submit" size="sm" variant="secondary">
              Szűrés
            </Button>
          </Form>
          {log.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nincs találat a szűrésre.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Mikor</TableHead>
                    <TableHead>Művelet</TableHead>
                    <TableHead>Ki</TableHead>
                    <TableHead>Részlet</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {log.entries.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(e.at)}</TableCell>
                      <TableCell className="font-medium">{actionLabel(e.action)}</TableCell>
                      <TableCell>{e.actorName ?? "Rendszer"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{e.detail ?? e.target}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      )}
    </Page>
  );
}

import { Form, Link } from "react-router";

import type { Route } from "./+types/admin.traffic";
import { AppPage } from "~/components/app-page";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { refLabel } from "~/lib/clubs";
import { listClubs } from "~/lib/clubs.server";
import { formatDay, formatPercent } from "~/lib/format";
import { buildFunnel, parsePeriod } from "~/lib/traffic";
import { currentPushStats, listPushDays, type PushStats } from "~/lib/push-stats.server";
import { listLandings } from "~/lib/traffic.server";

const CF_WEB_ANALYTICS = "https://dash.cloudflare.com/?to=/:account/web-analytics";

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "traffic.view" });
  const period = parsePeriod(new URL(request.url).searchParams, new Date());
  const [landings, clubs, push, pushDays] = await Promise.all([
    listLandings(period),
    listClubs(),
    currentPushStats(),
    listPushDays(period),
  ]);
  const funnel = buildFunnel(landings, period);
  return {
    period,
    total: funnel.total,
    sources: funnel.sources.map((r) => ({ ...r, label: refLabel(r.ref, clubs) || "Forrás nélkül" })),
    // Newest first.
    days: funnel.days.reverse(),
    push,
    pushDays: pushDays.reverse(),
  };
}

const num = "text-right tabular-nums";

function pushShare({ players, pushUsers }: Pick<PushStats, "players" | "pushUsers">): string {
  return players ? formatPercent(pushUsers / players) : "–";
}

export default function AdminTraffic({ loaderData }: Route.ComponentProps) {
  const { period, total, sources, days, push, pushDays } = loaderData;

  return (
    <AppPage
      title="Forgalom"
      description={
        <>
          Látogatás: a főoldal megnyitása böngészőben, forrásonként (<code>?ref=</code>, vagy ha nincs,{" "}
          <code>?utm_source=</code>; címke nélkül a hivatkozó oldal: <code>facebook</code>, <code>instagram</code>,{" "}
          <code>google</code>). Az újratöltés és a saját (Admin, Szervező) látogatás nem számít. Minden más (oldalak, honnan jöttek, eszközök):{" "}
          <a href={CF_WEB_ANALYTICS} target="_blank" rel="noreferrer" className="underline">
            Cloudflare Web Analytics
          </a>
          .
        </>
      }
    >

      <Form method="get" className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="from">Ettől</Label>
          <Input id="from" type="date" name="from" defaultValue={period.from} className="w-40" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="to">Eddig</Label>
          <Input id="to" type="date" name="to" defaultValue={period.to} className="w-40" />
        </div>
        <Button type="submit">Mutasd</Button>
        <Button variant="ghost" asChild>
          <Link to="/admin/traffic">Utolsó 30 nap</Link>
        </Button>
      </Form>

      <p className="text-lg">
        <strong>{total.landings}</strong> látogatás
      </p>

      <section className="grid gap-2">
        <h2 className="font-display text-lg font-bold">Forrásonként</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Forrás</TableHead>
              <TableHead className={num}>Látogatás</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 && (
              <TableRow>
                <TableCell colSpan={2} className="text-muted-foreground">
                  Ebben az időszakban nincs adat.
                </TableCell>
              </TableRow>
            )}
            {sources.map((r) => (
              <TableRow key={r.ref ?? ""}>
                <TableCell className={r.ref ? "" : "text-muted-foreground"}>{r.label}</TableCell>
                <TableCell className={num}>{r.landings}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Összesen</TableCell>
              <TableCell className={num}>{total.landings}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </section>

      <section className="grid gap-2">
        <h2 className="font-display text-lg font-bold">Naponta</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nap</TableHead>
              <TableHead className={num}>Látogatás</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d) => (
              <TableRow key={d.day}>
                <TableCell>{formatDay(d.day)}</TableCell>
                <TableCell className={num}>{d.landings}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
      <section className="grid gap-2">
        <h2 className="font-display text-lg font-bold">Push értesítés</h2>
        <p className="text-muted-foreground">
          Hány játékosnál van bekapcsolva most legalább egy eszközön (és nem kapcsolta ki a profilján). Az Admin, a
          Szervezők és a még be nem fejezett regisztrációk nem számítanak. A napi sor az aznapi utolsó állapot.
        </p>
        <p className="text-lg">
          <strong>{push.pushUsers}</strong> / {push.players} játékos · <strong>{pushShare(push)}</strong> ·{" "}
          {push.devices} eszköz
        </p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nap</TableHead>
              <TableHead className={num}>Push be</TableHead>
              <TableHead className={num}>Játékos</TableHead>
              <TableHead className={num}>Arány</TableHead>
              <TableHead className={num}>Eszköz</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pushDays.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground">
                  Ebben az időszakban még nincs napi adat.
                </TableCell>
              </TableRow>
            )}
            {pushDays.map((d) => (
              <TableRow key={d.day}>
                <TableCell>{formatDay(d.day)}</TableCell>
                <TableCell className={num}>{d.pushUsers}</TableCell>
                <TableCell className={num}>{d.players}</TableCell>
                <TableCell className={num}>{pushShare(d)}</TableCell>
                <TableCell className={num}>{d.devices}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </AppPage>
  );
}

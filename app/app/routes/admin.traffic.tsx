import { Form, Link } from "react-router";

import type { Route } from "./+types/admin.traffic";
import { Wrap } from "~/components/site";
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
import { requireAdmin } from "~/lib/access.server";
import { refLabel } from "~/lib/clubs";
import { listClubs } from "~/lib/clubs.server";
import { formatDay, formatPercent } from "~/lib/format";
import { buildFunnel, parsePeriod, type FunnelRow } from "~/lib/traffic";
import { listLandings, listSignupStamps } from "~/lib/traffic.server";

const CF_WEB_ANALYTICS = "https://dash.cloudflare.com/?to=/:account/web-analytics";

export async function loader({ request }: Route.LoaderArgs) {
  await requireAdmin(request);
  const period = parsePeriod(new URL(request.url).searchParams, new Date());
  const [landings, signups, clubs] = await Promise.all([
    listLandings(period),
    listSignupStamps(period),
    listClubs(),
  ]);
  const funnel = buildFunnel(landings, signups, period);
  return {
    period,
    total: funnel.total,
    sources: funnel.sources.map((r) => ({ ...r, label: refLabel(r.ref, clubs) || "Forrás nélkül" })),
    // Newest first, like the signups list.
    days: funnel.days.reverse(),
  };
}

function Rate({ row }: { row: Pick<FunnelRow, "conversion"> }) {
  return <>{row.conversion === null ? "–" : formatPercent(row.conversion)}</>;
}

const num = "text-right tabular-nums";

export default function AdminTraffic({ loaderData }: Route.ComponentProps) {
  const { period, total, sources, days } = loaderData;

  return (
    <Wrap className="grid grid-cols-1 gap-6 [&>*]:min-w-0">
      <div className="grid gap-1">
        <h1 className="font-display text-2xl font-extrabold">Forgalom</h1>
        <p className="text-sm text-muted-foreground">
          Látogatás: a főoldal megnyitása böngészőben, forrásonként (<code>?ref=</code>, vagy ha
          nincs, <code>?utm_source=</code>). Minden más (oldalak, honnan jöttek, eszközök):{" "}
          <a href={CF_WEB_ANALYTICS} target="_blank" rel="noreferrer" className="underline">
            Cloudflare Web Analytics
          </a>
          .
        </p>
      </div>

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
        <strong>{total.landings}</strong> látogatás · <strong>{total.signups}</strong> jelentkezés ·{" "}
        <strong>
          <Rate row={total} />
        </strong>{" "}
        konverzió
      </p>

      <section className="grid gap-2">
        <h2 className="font-display text-lg font-bold">Forrásonként</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Forrás</TableHead>
              <TableHead className={num}>Látogatás</TableHead>
              <TableHead className={num}>Jelentkezés</TableHead>
              <TableHead className={num}>Konverzió</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Ebben az időszakban nincs adat.
                </TableCell>
              </TableRow>
            )}
            {sources.map((r) => (
              <TableRow key={r.ref ?? ""}>
                <TableCell className={r.ref ? "" : "text-muted-foreground"}>{r.label}</TableCell>
                <TableCell className={num}>{r.landings}</TableCell>
                <TableCell className={num}>{r.signups}</TableCell>
                <TableCell className={num}>
                  <Rate row={r} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell>Összesen</TableCell>
              <TableCell className={num}>{total.landings}</TableCell>
              <TableCell className={num}>{total.signups}</TableCell>
              <TableCell className={num}>
                <Rate row={total} />
              </TableCell>
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
              <TableHead className={num}>Jelentkezés</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {days.map((d) => (
              <TableRow key={d.day}>
                <TableCell>{formatDay(d.day)}</TableCell>
                <TableCell className={num}>{d.landings}</TableCell>
                <TableCell className={num}>{d.signups}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </Wrap>
  );
}

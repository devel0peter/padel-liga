import { useState } from "react";
import { data, Link, useFetcher } from "react-router";

import type { Route } from "./+types/admin.league-solos";
import { AppPage } from "~/components/app-page";
import { PhoneLink } from "~/components/phone-link";
import { StatusChips } from "~/components/status-chips";
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
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { statusChips } from "~/lib/player-status";
import { playerStatuses } from "~/lib/player-status.server";
import { levelLabel } from "~/lib/signups-admin";
import { leagueSeekers, pairSeekers, searchPairs, type SearchPairPlayer } from "~/lib/partner-search.server";
import { cn } from "~/lib/utils";

// Párkeresők: a Szervező pairs up the league's registered players who
// switched on "Párt keresek" (D59, D127): two of them become an active pair
// at once; both get an in-app message and an email with the partner's name
// (#260). Nothing comes from the interest list (#333). No email addresses
// shown; phone numbers are, so the organizer can call (D126). Összehozott
// párok lists the active pairs made here (dissolved on Párok; D113, #297).

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league } = await scope(request, params.league);
  const [statuses, seekers, made] = await Promise.all([playerStatuses(), leagueSeekers(league), searchPairs(league.id)]);
  // A pair made here: name, level, phone (D126) and status; never email.
  const person = (p: SearchPairPlayer) => ({
    name: p.name,
    // No level: the "Nincs szintje" chip says so.
    level: levelLabel(p.level),
    phone: p.phone,
    status: statusChips(statuses.byEmail.get(p.email.toLowerCase()), [league.id]),
  });
  return {
    name: league.name,
    slug: league.slug,
    seekers: seekers.map((s) => ({ id: s.id, name: s.name, level: levelLabel(s.level), phone: s.phone, since: s.since })),
    searchPairs: made.map((p) => ({ id: p.id, players: [person(p.players[0]), person(p.players[1])] as const })),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  if (form.get("intent") === "create") {
    const [a, b] = form.getAll("user").map(String);
    const result = await pairSeekers(actor.id, league, a ?? "", b ?? "");
    return result.ok ? { ok: true } : { error: result.error };
  }
  throw new Response("Ismeretlen művelet.", { status: 400 });
}

// Below sm the date goes under the name and its column hides (#146), so
// nothing is cut at 390px; the desktop table is unchanged.
const WIDE = "hidden sm:table-cell";

type Person = Route.ComponentProps["loaderData"]["searchPairs"][number]["players"][number];

function Who({ row }: { row: Person }) {
  return (
    <div>
      <div className="font-medium">{row.name}</div>
      <div className="text-xs text-muted-foreground">{row.level}</div>
      <PhoneLink phone={row.phone} />
      <div className="mt-1">
        <StatusChips chips={row.status} />
      </div>
    </div>
  );
}

type Seeker = Route.ComponentProps["loaderData"]["seekers"][number];

// Registered players looking for a partner (D59): two of them become an
// active pair at once.
function Seekers({ seekers }: { seekers: Seeker[] }) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [selected, setSelected] = useState<string[]>([]);
  const chosen = seekers.filter((r) => selected.includes(r.id));
  const busy = fetcher.state !== "idle";
  const toggle = (id: string, on: boolean) =>
    setSelected((s) => (on ? [...s.filter((x) => x !== id), id].slice(-2) : s.filter((x) => x !== id)));
  const pair = () => {
    const form = new FormData();
    form.set("intent", "create");
    for (const r of chosen) form.append("user", r.id);
    fetcher.submit(form, { method: "post" });
    setSelected([]);
  };

  return (
    <section aria-label="Regisztráltak" className="grid gap-3 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">Regisztráltak ({seekers.length})</h2>
          <p className="text-sm text-muted-foreground">
            Bekapcsolták a „Párt keresek” jelzést. A párosítás után rögtön párban vannak.
          </p>
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button disabled={chosen.length !== 2 || busy}>Párba teszem ({chosen.length}/2)</Button>
          </AlertDialogTrigger>
          {chosen.length === 2 && (
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {chosen[0].name} és {chosen[1].name}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  Rögtön párban lesznek, és nevezhetnek. Az oldalon és e-mailben is szólunk nekik. A Párok oldalon
                  bonthatod fel.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Mégse</AlertDialogCancel>
                <AlertDialogAction onClick={pair}>Párba teszem</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          )}
        </AlertDialog>
      </div>
      {fetcher.data?.error && (
        <p role="alert" className="font-semibold text-destructive">
          {fetcher.data.error}
        </p>
      )}
      {seekers.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">Most egy regisztrált játékos sem keres párt.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <span className="sr-only">Kijelölés</span>
                </TableHead>
                <TableHead>Játékos</TableHead>
                <TableHead className={WIDE}>Párt keres</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {seekers.map((row) => (
                <TableRow key={row.id} data-state={selected.includes(row.id) ? "selected" : undefined}>
                  <TableCell>
                    <Checkbox
                      aria-label={`${row.name} kijelölése`}
                      checked={selected.includes(row.id)}
                      onCheckedChange={(on) => toggle(row.id, on === true)}
                    />
                  </TableCell>
                  <TableCell className="min-w-48 max-sm:whitespace-normal">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">{row.level || "Nincs szintje"}</div>
                    <PhoneLink phone={row.phone} />
                    <div className="text-xs text-muted-foreground sm:hidden">Párt keres: {formatDateTime(new Date(row.since))}</div>
                  </TableCell>
                  <TableCell className={cn("text-xs whitespace-nowrap text-muted-foreground", WIDE)}>
                    {formatDateTime(new Date(row.since))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

export default function LeagueSolos({ loaderData }: Route.ComponentProps) {
  const { name, slug, seekers, searchPairs } = loaderData;
  return (
    <AppPage
      title="Párkeresők"
      description={`${name} · ${seekers.length} regisztrált játékos keres párt, ${searchPairs.length} párt hoztál össze`}
    >
      <p className="max-w-2xl text-muted-foreground">
        Jelölj ki két hasonló szintű játékost, és tedd őket párba. Szint szerint vannak sorban. Az e-mail-címüket nem
        látod.
      </p>

      <Seekers seekers={seekers} />

      {searchPairs.length > 0 && (
        <section aria-label="Összehozott párok" className="grid gap-3 [&>*]:min-w-0">
          <h2 className="font-semibold">Összehozott párok</h2>
          <div className="rounded-lg border">
            <Table>
              <TableBody>
                {searchPairs.map(({ id, players: [a, b] }) => (
                  <TableRow key={`pair-${id}`}>
                    <TableCell className="min-w-48 max-sm:whitespace-normal">
                      <Who row={a} />
                      <div className="mt-3 sm:hidden">
                        <Who row={b} />
                      </div>
                    </TableCell>
                    <TableCell className={cn("min-w-48", WIDE)}>
                      <Who row={b} />
                    </TableCell>
                    <TableCell className="text-right text-xs whitespace-normal text-muted-foreground">
                      <Link to={`/admin/leagues/${slug}/pairs`} className="underline underline-offset-2 hover:text-foreground">
                        A Párok oldalon bonthatod fel
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      )}
    </AppPage>
  );
}

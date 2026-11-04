import { useState } from "react";
import { data, useFetcher } from "react-router";

import type { Route } from "./+types/admin.league-solos";
import { AppPage } from "~/components/app-page";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { requirePermission } from "~/lib/auth/admin.server";
import { cityName } from "~/lib/cities";
import { listCities } from "~/lib/cities.server";
import { homeClubLabel } from "~/lib/clubs";
import { listClubs } from "~/lib/clubs.server";
import { formatDateTime } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { statusChips } from "~/lib/player-status";
import { playerStatuses, type PlayerStatuses } from "~/lib/player-status.server";
import { levelLabel, type SignupRow } from "~/lib/signups-admin";
import { listSignups } from "~/lib/signups-admin.server";
import { soloPairs, waitingSolos } from "~/lib/solo-pairing";
import { pairSolos, unpairSolo } from "~/lib/solo-pairing.server";
import { leagueSeekers, pairSeekers } from "~/lib/partner-search.server";

// Párkeresők: a Szervező pairs up players who look for a partner. Registered
// players who switched on "Párt keresek" (or whose solo signup still waits,
// D59) become an active pair at once; both get an in-app message and an
// email with the partner's name (#260).
// Solos from the interest list who haven't registered yet are paired as
// before: both get an email with each other's name and address (pairIntro),
// and the pair forms once both have registered. No email addresses shown.

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, cityName: cityName(league.city, await listCities()) };
}

// Only what pairing needs: no email, no admin note, no source. `status`:
// whether they registered, and their pair and entry in this league (someone
// waiting here may already have a pair from the Párok page).
function publicRow(r: SignupRow, clubs: Awaited<ReturnType<typeof listClubs>>, statuses: PlayerStatuses, leagueId: number) {
  return {
    id: r.id,
    name: r.name1,
    level: levelLabel(r.level),
    plays: homeClubLabel(r.homeClub, clubs),
    note: r.note,
    status: statusChips(statuses.byEmail.get(r.email1.toLowerCase()), [leagueId]),
    createdAt: r.createdAt,
  };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, cityName } = await scope(request, params.league);
  const [signups, clubs, statuses, seekers] = await Promise.all([
    listSignups(),
    listClubs(),
    playerStatuses(),
    leagueSeekers(league),
  ]);
  const row = (r: SignupRow) => publicRow(r, clubs, statuses, league.id);
  return {
    name: league.name,
    cityName,
    seekers: seekers.map((s) => ({
      id: s.id,
      name: s.name,
      level: levelLabel(s.level),
      plays: homeClubLabel(s.homeClub, clubs),
      note: s.note,
      fromSignup: s.fromSignup,
      since: s.since,
    })),
    // Registered ones are in `seekers` (or have a pair, or stopped looking).
    waiting: waitingSolos(signups, league.city)
      .filter((r) => !statuses.byEmail.get(r.email1.toLowerCase())?.registered)
      .map(row),
    pairs: soloPairs(signups, league.city).map(([a, b]) => [row(a), row(b)] as const),
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { league, cityName } = await scope(request, params.league);
  const form = await request.formData();
  if (form.get("intent") === "create") {
    const [a, b] = form.getAll("user").map(String);
    const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
    const result = await pairSeekers(actor.id, league, a ?? "", b ?? "");
    return result.ok ? { ok: true } : { error: result.error };
  }
  const ids = form.getAll("id").map(Number);
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) throw new Response("Hibás azonosító.", { status: 400 });

  const intent = form.get("intent");
  if (intent === "pair") {
    if (ids.length !== 2) return { error: "Pontosan két játékost válassz." };
    const error = await pairSolos(ids[0], ids[1], league.city, cityName);
    return error ? { error } : { ok: true };
  }
  if (intent === "unpair" && ids.length === 1) {
    await unpairSolo(ids[0], league.city);
    return { ok: true };
  }
  throw new Response("Ismeretlen művelet.", { status: 400 });
}

type Row = Route.ComponentProps["loaderData"]["waiting"][number];

function Who({ row }: { row: Row }) {
  return (
    <div>
      <div className="font-medium">{row.name}</div>
      <div className="text-xs text-muted-foreground">
        {row.level}
        {row.plays && ` · ${row.plays}`}
      </div>
      <div className="mt-1">
        <StatusChips chips={row.status} />
      </div>
    </div>
  );
}

function UnpairButton({ a, b }: { a: Row; b: Row }) {
  const fetcher = useFetcher();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" disabled={fetcher.state !== "idle"}>
          Szétválasztom
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Szétválasztod őket?</AlertDialogTitle>
          <AlertDialogDescription>
            {a.name} és {b.name} visszakerül a párkeresők közé. Nem kapnak róla e-mailt; ha már
            beszéltek, szólj nekik te.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Mégse</AlertDialogCancel>
          <AlertDialogAction onClick={() => fetcher.submit({ intent: "unpair", id: String(a.id) }, { method: "post" })}>
            Szétválasztom
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
            Bekapcsolták a „Párt keresek” jelzést, vagy egyedül jelentkeztek. A párosítás után rögtön párban vannak.
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
                <TableHead>Megjegyzés</TableHead>
                <TableHead>Párt keres</TableHead>
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
                  <TableCell className="min-w-48">
                    <div className="font-medium">{row.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.level || "Nincs szintje"}
                      {row.plays && ` · ${row.plays}`}
                      {row.fromSignup && " · egyedül jelentkezett"}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-72 text-sm whitespace-normal">{row.note}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
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
  const { name, cityName, seekers, waiting, pairs } = loaderData;
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const [selected, setSelected] = useState<number[]>([]);
  const chosen = waiting.filter((r) => selected.includes(r.id));
  const busy = fetcher.state !== "idle";

  const toggle = (id: number, on: boolean) =>
    setSelected((s) => (on ? [...s.filter((x) => x !== id), id].slice(-2) : s.filter((x) => x !== id)));

  const pair = () => {
    // FormData, not an object: an array value would be sent as one "11,12" field.
    const form = new FormData();
    form.set("intent", "pair");
    for (const r of chosen) form.append("id", String(r.id));
    fetcher.submit(form, { method: "post" });
    setSelected([]);
  };

  return (
    <AppPage
      title="Párkeresők"
      description={`${name} · ${seekers.length} regisztrált és ${waiting.length} még nem regisztrált játékos keres párt, ${pairs.length} párt hoztál össze`}
    >
      <p className="max-w-2xl text-muted-foreground">
        Jelölj ki két hasonló szintű játékost, és tedd őket párba. Szint szerint vannak sorban. Az e-mail-címüket nem
        látod.
      </p>

      <Seekers seekers={seekers} />

      <section aria-label="Még nem regisztráltak" className="grid gap-3 [&>*]:min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Még nem regisztráltak ({waiting.length})</h2>
            <p className="text-sm text-muted-foreground">
              Egyedül jelentkeztek előre. A párosításkor e-mailben megkapják egymás címét, és amint mindketten
              regisztráltak, párban vannak.
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
                    Mindketten most e-mailt kapnak a másik nevével, szintjével és
                    e-mail-címével, hogy megbeszélhessék. A párosítást nem lehet visszavonni.
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

        {waiting.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            Most senki nem keres párt a még nem regisztráltak közül ({cityName}).
          </p>
        ) : (
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <span className="sr-only">Kijelölés</span>
                  </TableHead>
                  <TableHead>Játékos</TableHead>
                  <TableHead>Megjegyzés</TableHead>
                  <TableHead>Jelentkezett</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waiting.map((row) => (
                  <TableRow key={row.id} data-state={selected.includes(row.id) ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        aria-label={`${row.name} kijelölése`}
                        checked={selected.includes(row.id)}
                        onCheckedChange={(on) => toggle(row.id, on === true)}
                      />
                    </TableCell>
                    <TableCell className="min-w-48">
                      <Who row={row} />
                    </TableCell>
                    <TableCell className="max-w-72 text-sm whitespace-normal">{row.note}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap text-muted-foreground">
                      {formatDateTime(new Date(row.createdAt))}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {pairs.length > 0 && (
        <section className="grid gap-3 [&>*]:min-w-0">
          <h2 className="font-semibold">Összehozott párok</h2>
          <div className="rounded-lg border">
            <Table>
              <TableBody>
                {pairs.map(([a, b]) => (
                  <TableRow key={a.id}>
                    <TableCell className="min-w-48">
                      <Who row={a} />
                    </TableCell>
                    <TableCell className="min-w-48">
                      <Who row={b} />
                    </TableCell>
                    <TableCell className="text-right">
                      <UnpairButton a={a} b={b} />
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

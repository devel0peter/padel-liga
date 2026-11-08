import { DIVISIONS, DIVISION_NAMES } from "@padel-liga/rules";
import { Link, useSearchParams } from "react-router";

import type { Route } from "./+types/rankings";
import { AppPage } from "~/components/app-page";
import { Card, CardContent } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";
import { requireUser } from "~/lib/auth/session.server";
import { DIVISION_DOT, DIVISION_EDGE } from "~/lib/division-colors";
import type { RankRow } from "~/lib/rankings";
import { rankingsPage } from "~/lib/rankings.server";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// The Ranglista (D137): a league's players and pairs by Élő-pont, in two
// tabs (`?view=pairs`). For logged-in players only, inside the app shell;
// names and ratings only. Ties share a place until #345 brings the rules.
// Each row's left edge has its division's colour, as on the Tabella (D138).
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const page = await rankingsPage(params.league ?? "", user.id);
  if (!page) throw new Response("Nincs ilyen liga.", { status: 404 });
  return page;
}

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `Ranglista: ${loaderData?.league.name ?? "liga"} – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

const num = "px-2 text-right tabular-nums";

function Ranking({ rows, label, own, players }: { rows: RankRow[]; label: string; own: string; players: boolean }) {
  if (rows.length === 0) return <p className="text-muted-foreground">Még nincs kit rangsorolni.</p>;
  return (
    <Card className="max-w-2xl py-0">
      <CardContent className="px-0">
        <Table aria-label={label}>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="w-12 px-3">#</TableHead>
              <TableHead className="px-2">{players ? "Játékos" : "Pár"}</TableHead>
              <TableHead className={cn(num, "w-20")}>Élő-pont</TableHead>
              {players && (
                <TableHead className={cn(num, "w-16 pr-3")} title="Értékelt meccsek">
                  Meccs
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.key} className={cn(r.mine && "bg-nav-active-bg/60 font-semibold hover:bg-nav-active-bg/80")}>
                <TableCell className={cn("border-l-4 px-3 font-bold tabular-nums", r.division ? DIVISION_EDGE[r.division] : "border-l-transparent")}>
                  {r.place}.
                </TableCell>
                <TableCell className="px-2 whitespace-normal">
                  {r.href ? (
                    <Link to={r.href} className="break-words">
                      {r.name}
                    </Link>
                  ) : (
                    r.name
                  )}
                  {r.mine && <span className="text-xs font-semibold text-nav-active"> ({own})</span>}
                  {r.division && <span className="sr-only">, {DIVISION_NAMES[r.division]} divízió</span>}
                </TableCell>
                <TableCell className={cn(num, "font-extrabold")}>{r.elo}</TableCell>
                {players && <TableCell className={cn(num, "pr-3")}>{r.matches}</TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// What the colours mean, once above both tabs.
function DivisionLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Divíziók">
      {DIVISIONS.map((d) => (
        <li key={d} className="flex items-center gap-1.5">
          <span aria-hidden className={cn("size-2.5 rounded-full", DIVISION_DOT[d])} />
          {DIVISION_NAMES[d]}
        </li>
      ))}
      <li>A szín: a pár divíziója a Tabellán.</li>
    </ul>
  );
}

export default function Rankings({ loaderData: d }: Route.ComponentProps) {
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "pairs" ? "pairs" : "players";
  return (
    <AppPage
      title="Ranglista"
      description={
        <>
          {d.league.name} · Élő-pont szerint.{" "}
          <Link to="/rules#section-8" className="font-medium">
            Mi az Élő-pont?
          </Link>
        </>
      }
    >
      {!d.started ? (
        <p className="text-muted-foreground">Az Élő-pontok a liga indulása után látszanak itt.</p>
      ) : (
        <Tabs
          value={view}
          onValueChange={(value) => setParams(value === "pairs" ? { view: "pairs" } : {}, { replace: true, preventScrollReset: true })}
          className="gap-4"
        >
          <TabsList>
            <TabsTrigger value="players">Játékosok</TabsTrigger>
            <TabsTrigger value="pairs">Párok</TabsTrigger>
          </TabsList>
          <DivisionLegend />
          <TabsContent value="players" className="grid gap-2">
            <Ranking rows={d.players} label="Játékosok Élő-pont szerint" own="te" players />
            <p className="text-xs text-muted-foreground">Meccs: az Élő-pontot változtató meccsek. Azonos Élő-pontnál egyelőre közös a hely.</p>
          </TabsContent>
          <TabsContent value="pairs" className="grid gap-2">
            <Ranking rows={d.pairs} label="Párok Élő-pont szerint" own="ti" players={false} />
            <p className="text-xs text-muted-foreground">A pár Élő-pontja a két játékos átlaga. Azonos Élő-pontnál egyelőre közös a hely.</p>
          </TabsContent>
        </Tabs>
      )}
    </AppPage>
  );
}

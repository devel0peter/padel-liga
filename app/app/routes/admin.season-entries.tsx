import { Check, X } from "lucide-react";
import { data, Form, Link, useNavigation } from "react-router";

import type { Route } from "./+types/admin.season-entries";
import { AppPage } from "~/components/app-page";
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
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime, formatShortDate } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { canDecide, ENTRY_FILTERS, fromPhase, MAX_NOTE, parseEntryFilter, parseNote, type Decision } from "~/lib/season-entries";
import { decideEntry, entryCounts, listSeasonEntries, seasonOfLeague } from "~/lib/season-entries.server";
import { levelLabel } from "~/lib/signups-admin";
import { SITE_NAME } from "~/lib/site";

// A season's entries for the league's Szervezők (#23, D17): filter by status,
// approve or reject with an optional note (both players are emailed), and
// change an earlier decision. Names and levels only, no contact details.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Nevezések – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function scope(request: Request, params: Route.LoaderArgs["params"]) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.season);
  // Another league's season can't be reached through this league's URL.
  const season = Number.isInteger(id) && id > 0 ? await seasonOfLeague(id, league.id) : undefined;
  if (!season) throw data("Nincs ilyen szezon.", { status: 404 });
  return { league, actor, season };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, season } = await scope(request, params);
  const status = parseEntryFilter(new URL(request.url).searchParams.get("status"));
  const [rows, counts] = await Promise.all([listSeasonEntries(season.id, status), entryCounts([season.id])]);
  return {
    league: { name: league.name, slug: league.slug },
    season: { id: season.id, name: season.name },
    status,
    counts: counts.get(season.id)!,
    rows: rows.map((r) => ({
      ...r,
      canApprove: canDecide(r.status, "approve", r.pairActive),
      canReject: canDecide(r.status, "reject", r.pairActive),
    })),
  };
}

type ActionData = { error?: string; notice?: string };

const DONE: Record<Decision, string> = {
  approve: "Jóváhagytad. A két játékos most értesítést kap róla.",
  reject: "Elutasítottad. A két játékos most értesítést kap róla.",
};

export async function action({ request, params }: Route.ActionArgs): Promise<ActionData> {
  const { actor, season } = await scope(request, params);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = Number(form.get("id") || 0);
  if ((intent !== "approve" && intent !== "reject") || !Number.isInteger(id) || id <= 0)
    throw new Response("Hibás kérés.", { status: 400 });
  const note = parseNote(form.get("note"));
  if (!note.ok) return { error: note.error };
  const result = await decideEntry(actor, season.id, id, intent, note.note);
  return result.ok ? { notice: DONE[intent] } : { error: result.error };
}

type Row = Route.ComponentProps["loaderData"]["rows"][number];

const pairName = (r: Row) => r.players.map((p) => p.name || "Névtelen").join(" – ");

function DecisionDialog({ row, decision }: { row: Row; decision: Decision }) {
  const busy = useNavigation().state !== "idle";
  const approve = decision === "approve";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant={approve ? "default" : "outline"} size="sm" disabled={busy}>
          {approve ? <Check /> : <X />}
          {approve ? "Jóváhagyás" : "Elutasítás"}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <Form method="post" className="grid gap-4">
          <input type="hidden" name="intent" value={decision} />
          <input type="hidden" name="id" value={row.id} />
          <AlertDialogHeader>
            <AlertDialogTitle>
              {approve ? "Jóváhagyod" : "Elutasítod"}: {pairName(row)}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Mindkét játékos most értesítést kap róla, e-mailben is, ha nem kapcsolta ki. Az üzenetedet, ha
              írsz, a levélben és a Párom oldalon látják.
              {approve &&
                " Ha a szezon már elindult, a következő körtől játszanak; ha már az utolsó kör fut, a következő szezontól."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={`note-${decision}-${row.id}`}>Üzenet (nem kötelező)</Label>
            <Textarea id={`note-${decision}-${row.id}`} name="note" maxLength={MAX_NOTE} rows={3} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Mégse</AlertDialogCancel>
            <AlertDialogAction type="submit" variant={approve ? "default" : "destructive"}>
              {approve ? "Jóváhagyás" : "Elutasítás"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </Form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export default function SeasonEntries({ loaderData: d, actionData }: Route.ComponentProps) {
  const seasonsPage = `/admin/leagues/${d.league.slug}/seasons`;
  const decided = d.status !== "pending";
  return (
    <AppPage
      title={`Nevezések: ${d.season.name}`}
      description={<>{d.league.name}: a jóváhagyott párok kerülnek a csoportokba.</>}
      back={{ to: seasonsPage, label: "Szezonok" }}
    >
      <nav aria-label="Szűrés" className="flex flex-wrap gap-2">
        {Object.entries(ENTRY_FILTERS).map(([key, label]) => (
          <Button key={key} variant={d.status === key ? "default" : "outline"} size="sm" asChild>
            <Link to={key === "pending" ? "?" : `?status=${key}`} aria-current={d.status === key ? "page" : undefined}>
              {label} ({d.counts[key as keyof typeof d.counts]})
            </Link>
          </Button>
        ))}
      </nav>

      {actionData?.notice && (
        <p role="status" className="rounded-md border border-nav-active bg-nav-active-bg p-3 text-sm font-medium">
          {actionData.notice}
        </p>
      )}
      {actionData?.error && (
        <p role="alert" className="font-semibold text-destructive">
          {actionData.error}
        </p>
      )}

      {d.rows.length === 0 ? (
        <p className="py-6 text-center text-muted-foreground">Nincs ilyen nevezés.</p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pár</TableHead>
                <TableHead>Szint</TableHead>
                <TableHead>Kezdő Elo (átlag)</TableHead>
                <TableHead>Nevezett</TableHead>
                {d.status === "approved" && <TableHead>Kezd</TableHead>}
                {decided && <TableHead>Üzenet</TableHead>}
                <TableHead>
                  <span className="sr-only">Műveletek</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {d.rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {pairName(r)}
                    {!r.pairActive && (
                      <Badge variant="outline" className="ml-2">
                        megszűnt
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{r.players.map((p) => (p.level ? levelLabel(p.level) : "–")).join(" / ")}</TableCell>
                  <TableCell>{r.averageElo ?? "–"}</TableCell>
                  <TableCell>{formatDateTime(new Date(r.appliedAt))}</TableCell>
                  {d.status === "approved" && (
                    <TableCell>{r.joinsPhase === null ? "következő szezon" : fromPhase(r.joinsPhase)}</TableCell>
                  )}
                  {decided && (
                    <TableCell className="max-w-64 whitespace-pre-line text-muted-foreground">
                      {r.note}
                      {r.decidedAt && <span className="block text-xs">{formatShortDate(new Date(r.decidedAt))}</span>}
                    </TableCell>
                  )}
                  <TableCell>
                    <div className="flex flex-wrap justify-end gap-2">
                      {r.canApprove && <DecisionDialog row={r} decision="approve" />}
                      {r.canReject && <DecisionDialog row={r} decision="reject" />}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </AppPage>
  );
}

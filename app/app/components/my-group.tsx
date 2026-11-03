import { ChevronRight, Phone } from "lucide-react";
import { Link } from "react-router";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { formatDeadline, signed } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { groupLine, statusView, telHref, todoFor, type Tone } from "~/lib/matches";
import type { HomeGroup, Opponent } from "~/lib/matches.server";
import { resultStatusView, resultTodo } from "~/lib/results";
import { cn } from "~/lib/utils";

// Kezdőlap once the groups are out (#25): the Teendők, then the player's
// group and matches by week. Mobile first: nothing scrolls sideways at 390 px.

const TONE: Record<Tone, string> = {
  todo: "bg-nav-active-bg text-nav-active",
  waiting: "bg-muted text-muted-foreground",
  done: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-semibold", TONE[tone])}>{label}</span>;
}

// The other pair's phone numbers, tap to call (#25 requirement 4). Never an
// email address.
export function Contacts({ contacts }: { contacts: Opponent[] }) {
  if (contacts.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      {contacts.map((c) => (
        <li key={c.name} className="min-w-0">
          {c.phone ? (
            <a href={telHref(c.phone)} className="inline-flex items-center gap-1 underline">
              <Phone className="size-3.5 shrink-0" />
              <span className="break-words">
                {c.name}: {c.phone}
              </span>
            </a>
          ) : (
            <span className="text-muted-foreground">{c.name}: nincs telefonszám</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export type Todo = { matchId: number; text: string };

export function todos(groups: readonly HomeGroup[]): Todo[] {
  return groups.flatMap((g) =>
    g.matches.flatMap((m) => {
      // Once a result exists, only its confirmation can be a Teendő (#28).
      const text = m.result.status === "none" ? todoFor(m.state, m.side, m.opponents) : resultTodo(m.result, m.side, m.opponents);
      return text ? [{ matchId: m.id, text }] : [];
    }),
  );
}

// Teendők (#25 requirement 3, spec 13): every open item, each a link to it.
export function Todos({ items }: { items: Todo[] }) {
  return (
    <section aria-labelledby="teendok" className="grid max-w-2xl gap-2 rounded-lg border border-nav-active bg-nav-active-bg p-4 sm:p-6">
      <h2 id="teendok" className="font-display text-lg font-bold">
        Teendők
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground">Most nincs teendőd.</p>
      ) : (
        <ul className="grid gap-1">
          {items.map((t) => (
            <li key={`${t.matchId}:${t.text}`}>
              <Link to={`/matches/${t.matchId}`} className="inline-flex items-start gap-1 font-medium underline">
                <ChevronRight className="mt-0.5 size-4 shrink-0" />
                {t.text}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The group's standing (#201): the public league page's table (rank, matches,
// points, set and game difference), from final results only. Before any
// result there is no ranking to show, so the pairs are listed without numbers.
function GroupTable({ pairs }: { pairs: HomeGroup["pairs"] }) {
  if (pairs.every((p) => p.matches === 0)) {
    return (
      <ul className="grid gap-1" aria-label="Párok">
        {pairs.map((p) => (
          <li key={p.pairId} className={cn("break-words", p.mine && "font-semibold")}>
            {p.name}
            {p.mine && " (ti)"}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <Table className="table-fixed" aria-label="Tabella">
      <TableHeader>
        <TableRow>
          <TableHead className="w-7 px-1">#</TableHead>
          <TableHead className="px-1">Pár</TableHead>
          <TableHead className="w-9 px-1 text-right" title="Lejátszott meccsek">
            M
          </TableHead>
          <TableHead className="w-9 px-1 text-right" title="Pont">
            P
          </TableHead>
          <TableHead className="w-11 px-1 text-right" title="Szettkülönbség">
            Szett
          </TableHead>
          <TableHead className="w-12 px-1 text-right" title="Játékkülönbség">
            Játék
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {pairs.map((p) => (
          <TableRow key={p.pairId} className={cn(p.mine && "font-semibold")}>
            <TableCell className="px-1 font-bold">{p.rank}.</TableCell>
            <TableCell className="px-1 break-words whitespace-normal">
              {p.name}
              {p.mine && " (ti)"}
            </TableCell>
            <TableCell className="px-1 text-right">{p.matches}</TableCell>
            <TableCell className="px-1 text-right font-bold">{p.points}</TableCell>
            <TableCell className="px-1 text-right">{signed(p.setDiff)}</TableCell>
            <TableCell className="px-1 text-right">{signed(p.gameDiff)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MyGroup({ group: g, multiLeague }: { group: HomeGroup; multiLeague: boolean }) {
  const weeks = [1, 2, 3].map((week) => ({ week, match: g.matches.find((m) => m.week === week) ?? null }));
  return (
    <Card className="max-w-2xl" aria-label={groupLine(g.number, g.groupCount)}>
      <CardHeader>
        <CardTitle className="font-display text-lg">{groupLine(g.number, g.groupCount)}</CardTitle>
        <CardDescription>
          {multiLeague ? `${g.league}, ` : ""}
          {g.season}, {g.phase}. kör · határidő: {formatDeadline(g.deadline)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <GroupTable pairs={g.pairs} />
        <ul className="grid gap-3" aria-label="Meccseitek">
          {weeks.map(({ week, match: m }) => (
            <li key={week} className="grid gap-1.5 rounded-md border p-3">
              <p className="text-xs font-semibold text-muted-foreground">
                {week}. hét · {weekRange(g.phaseStartsAt, week)}
              </p>
              {m ? (
                <>
                  <p className="font-medium break-words">{m.opponents} ellen</p>
                  <div>
                    <StatusPill {...(resultStatusView(m.result, m.side) ?? statusView(m.state, m.side, m.venue))} />
                  </div>
                  <Contacts contacts={m.contacts} />
                  <Link to={`/matches/${m.id}`} className="inline-flex w-fit items-center gap-1 font-semibold underline">
                    Egyeztetés és részletek
                    <ChevronRight className="size-4" />
                  </Link>
                </>
              ) : (
                <p className="text-muted-foreground">Pihenőhét: ezen a héten nem játszotok.</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

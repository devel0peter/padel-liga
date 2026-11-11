import { Link } from "react-router";

import { RoundBurndown } from "~/components/round-burndown";
import { Badge } from "~/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import { formatWeekdayDate } from "~/lib/format";
import { groupLine } from "~/lib/matches";
import { daysLeftText, LIST_ANCHOR, paceText, SECTION_ANCHOR, shareText, verdictText, VERDICT_SHORT, type RoundStatus, type Verdict } from "~/lib/round-status";

// "A kör állása" at the top of "Meccsek" (#350): totals by status, progress,
// the verdict, the burn-down, and per week and per group, each count a link
// to the list below filtered to those matches. With two rounds running at
// once the list's filters span both, so the counts are not links then.

const VERDICT_BADGE: Record<Verdict, "default" | "destructive" | "secondary"> = {
  on_track: "default",
  behind: "destructive",
  early: "secondary",
};

const TILE = "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm";

// `to` null: the same tile without a link.
function CountLink({ to, label, count }: { to: string | null; label: string; count: number }) {
  const inner = (
    <>
      <span>{label}</span>
      <span className="font-semibold tabular-nums">{count}</span>
    </>
  );
  return to === null ? (
    <p className={TILE}>{inner}</p>
  ) : (
    <Link to={to} className={`${TILE} no-underline hover:bg-muted`}>
      {inner}
    </Link>
  );
}

function RowLink({ to, children }: { to: string | null; children: React.ReactNode }) {
  return to === null ? (
    <span className="font-medium">{children}</span>
  ) : (
    <Link to={to} className="font-medium underline">
      {children}
    </Link>
  );
}

// `anchor`: the first section only, so the id stays unique. `linked`: false
// when another round runs too.
export function RoundStatusSection({
  round,
  groupCount,
  title,
  anchor,
  linked = true,
}: {
  round: RoundStatus;
  groupCount: number;
  title: string;
  anchor?: boolean;
  linked?: boolean;
}) {
  const started = round.today >= round.firstDay;
  const filterLink = (params: Record<string, string>) => (linked ? `?${new URLSearchParams(params)}#${LIST_ANCHOR}` : null);
  return (
    <Card role="region" aria-label={title} id={anchor ? SECTION_ANCHOR : undefined} className="max-w-3xl scroll-mt-6">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">
          {title}
        </CardTitle>
        <CardDescription>
          Lejátszva {round.played}/{round.total} ({shareText(round.played, round.total)}) · Fixálva vagy lejátszva {round.fixed}/{round.total} · határidő:{" "}
          {formatWeekdayDate(new Date(`${round.deadlineDay}T12:00:00Z`))}, {daysLeftText(round.daysLeft)}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5">
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <Badge variant={VERDICT_BADGE[round.verdict]}>{VERDICT_SHORT[round.verdict]}</Badge>
            <span>{verdictText(round)}</span>
          </p>
          {started && round.total > round.played && <p className="text-sm text-muted-foreground">{paceText(round)}</p>}
        </div>

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Állapotok</h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {round.counts.map((c) => (
              <CountLink key={c.status} to={filterLink({ status: c.status })} label={c.label} count={c.count} />
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <CountLink to={filterLink({ stuck: "1" })} label="Elakadt" count={round.stuck} />
            <p className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
              <span>Nem számít (visszalépés)</span>
              <span className="font-semibold tabular-nums">{round.voided}</span>
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            Az állapotok összege {round.total} meccs; az elakadtak benne vannak, a visszalépett párok meccsei nem.
          </p>
        </div>

        <div className="grid gap-2">
          <h3 className="text-sm font-semibold">Napról napra</h3>
          <RoundBurndown round={round} />
          {!started && <p className="text-xs text-muted-foreground">A kör még nem kezdődött el: a vonalak az első napjától töltődnek.</p>}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="grid content-start gap-2">
            <h3 className="text-sm font-semibold">Hetente</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hét</TableHead>
                  <TableHead className="text-right">Lejátszva</TableHead>
                  <TableHead className="text-right">Nincs fix</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {round.weeks.map((w) => (
                  <TableRow key={w.week}>
                    <TableCell>
                      <RowLink to={filterLink({ week: String(w.week) })}>{w.week}. hét</RowLink>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {w.played}/{w.total}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{w.notFixed}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid content-start gap-2">
            <h3 className="text-sm font-semibold">Csoportonként</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Csoport</TableHead>
                  <TableHead className="text-right">Lejátszva</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {round.groups.map((g) => (
                  <TableRow key={g.group}>
                    <TableCell className="whitespace-normal">
                      <RowLink to={filterLink({ group: String(g.group) })}>{groupLine(g.group, groupCount)}</RowLink>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap tabular-nums">
                      {g.behind && (
                        <Badge variant="destructive" className="mr-2">
                          lemaradt
                        </Badge>
                      )}
                      {g.played}/{g.total}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

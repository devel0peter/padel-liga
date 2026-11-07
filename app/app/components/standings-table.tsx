import { ChevronDown, ChevronUp } from "lucide-react";
import { Link } from "react-router";

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "~/components/ui/table";
import type { Zone } from "~/lib/fixtures";
import { cn } from "~/lib/utils";

// A group's table (docs/player-ui.md section 2, D133): place, pair, played,
// wins, losses, sets and games won:lost, points; the places that move up or
// down at the end of the round are marked. One component for Kezdőlap and the
// public league page. Fits 390 px: the names wrap, the games column hides.

export type StandingsRow = {
  pairId: number;
  names: [string, string];
  rank: number;
  matches: number;
  wins: number;
  losses: number;
  setsWon: number;
  setsLost: number;
  gamesWon: number;
  gamesLost: number;
  points: number;
  zone: Zone;
  mine?: boolean;
};

const ZONE_ROW: Record<"up" | "down", string> = {
  up: "shadow-[inset_4px_0_0_var(--color-emerald-500)]",
  down: "shadow-[inset_4px_0_0_var(--color-rose-500)]",
};

function ZoneMark({ zone }: { zone: Zone }) {
  if (zone === "up")
    return (
      <>
        <ChevronUp aria-hidden className="size-4 shrink-0 text-emerald-600" />
        <span className="sr-only">feljutó hely</span>
      </>
    );
  if (zone === "down")
    return (
      <>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-rose-600" />
        <span className="sr-only">kieső hely</span>
      </>
    );
  return null;
}

function Names({ names }: { names: [string, string] }) {
  return (
    <span className="grid leading-snug">
      <span className="break-words">{names[0]}</span>
      <span className="break-words">{names[1]}</span>
    </span>
  );
}

const num = "px-1 text-right tabular-nums";

export function StandingsTable({
  rows,
  ranked,
  linkFor,
  label = "Tabella",
}: {
  rows: StandingsRow[];
  /** False before any final result: no places and no marks (D85). */
  ranked: boolean;
  /** A pair's profile link, or null (members only, D112). */
  linkFor?: (pairId: number) => string | null;
  label?: string;
}) {
  const zones = rows.some((r) => r.zone);
  return (
    <div className="grid gap-2">
      <Table className="table-fixed" aria-label={label}>
        <TableHeader>
          <TableRow className="text-xs">
            <TableHead className="w-8 px-1">#</TableHead>
            <TableHead className="px-1">Pár</TableHead>
            <TableHead className={cn(num, "w-6")} title="Lejátszott meccsek">
              M
            </TableHead>
            <TableHead className={cn(num, "w-6")} title="Győzelem">
              Gy
            </TableHead>
            <TableHead className={cn(num, "w-6")} title="Vereség">
              V
            </TableHead>
            <TableHead className={cn(num, "w-10")} title="Nyert és vesztett szettek">
              Szett
            </TableHead>
            <TableHead className={cn(num, "hidden w-14 sm:table-cell")} title="Nyert és vesztett játékok">
              Játék
            </TableHead>
            <TableHead className={cn(num, "w-7")} title="Pont">
              P
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const href = linkFor?.(r.pairId) ?? null;
            return (
              <TableRow key={r.pairId} className={cn(r.zone && ZONE_ROW[r.zone], r.mine && "bg-nav-active-bg/60 font-semibold hover:bg-nav-active-bg/80")}>
                <TableCell className="px-1">
                  <span className="flex items-center gap-0.5 font-bold">
                    {ranked ? `${r.rank}.` : "–"}
                    <ZoneMark zone={r.zone} />
                  </span>
                </TableCell>
                <TableCell className="px-1 whitespace-normal">
                  {href ? (
                    <Link to={href} className="underline decoration-court/40 underline-offset-2 hover:decoration-court">
                      <Names names={r.names} />
                    </Link>
                  ) : (
                    <Names names={r.names} />
                  )}
                  {r.mine && <span className="text-xs font-semibold text-nav-active"> (ti)</span>}
                </TableCell>
                <TableCell className={num}>{r.matches}</TableCell>
                <TableCell className={num}>{r.wins}</TableCell>
                <TableCell className={num}>{r.losses}</TableCell>
                <TableCell className={num}>
                  {r.setsWon}:{r.setsLost}
                </TableCell>
                <TableCell className={cn(num, "hidden sm:table-cell")}>
                  {r.gamesWon}:{r.gamesLost}
                </TableCell>
                <TableCell className={cn(num, "font-extrabold")}>{r.points}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {!ranked && <span>Még nincs végleges eredmény: a sorrend a kiemelés.</span>}
        {zones && (
          <>
            <span className="inline-flex items-center gap-0.5">
              <ChevronUp aria-hidden className="size-3.5 text-emerald-600" /> feljut
            </span>
            <span className="inline-flex items-center gap-0.5">
              <ChevronDown aria-hidden className="size-3.5 text-rose-600" /> kiesik a kör végén
            </span>
          </>
        )}
        <span>M: meccs · Gy: győzelem · V: vereség · P: pont (győzelem 3, vereség 1, játék nélkül 0)</span>
      </p>
    </div>
  );
}

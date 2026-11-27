import { Link } from "react-router";

import type { Zone } from "~/lib/fixtures";
import { cn } from "~/lib/utils";

// A group's table on the Tabella (docs/player-ui.md section 2, D133; direction
// A, #422, mockup P04): place, team, played, wins, losses, sets, games (from
// sm up) and points. One line per pair; the own row on the ball tint; ▲ next
// to a pair that goes up at the end of the round, ▼ to one that goes down,
// and the place in their colour. Fits 390 px.
// A pair shows as its team label, "Kovács / Nagy" (#419, lib/names.ts).

export type StandingsRow = {
  pairId: number;
  /** The team label, "Kovács / Nagy" (#419: teamLabeler over the group's players). */
  label: string;
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

function ZoneMark({ zone }: { zone: Zone }) {
  if (!zone) return null;
  return (
    <>
      <span aria-hidden className={cn("ml-1 text-[11px]", zone === "up" ? "text-success" : "text-danger")}>
        {zone === "up" ? "▲" : "▼"}
      </span>
      <span className="sr-only">{zone === "up" ? " feljutó hely" : " kieső hely"}</span>
    </>
  );
}

const num = "px-1 text-right tabular-nums";
const head = "h-8 px-1 text-xs font-normal text-muted-foreground";

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
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full table-fixed border-separate border-spacing-0 text-body" aria-label={label}>
        <thead>
          <tr>
            <th scope="col" className={cn(head, "w-7 pl-2.5 text-left")}>
              #
            </th>
            <th scope="col" className={cn(head, "text-left")}>
              Pár
            </th>
            <th scope="col" className={cn(head, num, "w-7")} title="Lejátszott meccsek">
              M
            </th>
            <th scope="col" className={cn(head, num, "w-7")} title="Győzelem">
              Gy
            </th>
            <th scope="col" className={cn(head, num, "w-6")} title="Vereség">
              V
            </th>
            <th scope="col" className={cn(head, num, "w-11")} title="Nyert és vesztett szettek">
              Szett
            </th>
            <th scope="col" className={cn(head, num, "hidden w-12 sm:table-cell")} title="Nyert és vesztett játékok">
              Játék
            </th>
            <th scope="col" className={cn(head, num, "w-8 pr-2.5")} title="Pont">
              P
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const href = linkFor?.(r.pairId) ?? null;
            return (
              <tr
                key={r.pairId}
                className={cn("[&>td]:h-11 [&>td]:py-1", r.mine && "font-bold [&>td]:bg-ball-tint [&>td:first-child]:rounded-l-[10px] [&>td:last-child]:rounded-r-[10px]")}
              >
                <td className={cn("pl-2.5 tabular-nums", r.mine ? "text-ball" : r.zone === "up" ? "text-success" : r.zone === "down" ? "text-danger" : "text-muted-foreground")}>
                  {ranked ? r.rank : "–"}
                </td>
                <td className="px-1">
                  <span className="break-words">
                    {href ? (
                      <Link to={href} className="text-inherit no-underline hover:underline">
                        {r.label}
                      </Link>
                    ) : (
                      r.label
                    )}
                    {ranked && <ZoneMark zone={r.zone} />}
                  </span>
                  {/* The own pair is on the ball tint (D143); the word is for screen readers only. */}
                  {r.mine && <span className="sr-only"> (ti)</span>}
                </td>
                <td className={num}>{r.matches}</td>
                <td className={num}>{r.wins}</td>
                <td className={num}>{r.losses}</td>
                <td className={num}>
                  {r.setsWon}:{r.setsLost}
                </td>
                <td className={cn(num, "hidden font-normal text-muted-foreground sm:table-cell")}>
                  {r.gamesWon}:{r.gamesLost}
                </td>
                <td className={cn(num, "pr-2.5 font-extrabold")}>{r.points}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!ranked && <p className="m-0 text-caption text-muted-foreground">Még nincs végleges eredmény: a sorrend a kiemelés.</p>}
    </div>
  );
}

// What the marks and the abbreviations mean, once on the page (one line).
export function StandingsLegend({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-caption text-muted-foreground">
      <span>
        <span className="text-success">▲</span> feljut · <span className="text-danger">▼</span> kiesik a kör végén · M meccs · Gy győzelem · V vereség · P
        pont (győzelem 3, vereség 1, játék nélkül 0)
      </span>
      {children}
    </div>
  );
}

import { cn } from "~/lib/utils";

// A result as a scoreboard (D181): one row per team, one box per set, the
// winner's row bold with "NYERT" and lighter boxes. Pair A first, as every
// result reads (docs/player-ui.md C6). No winner (not final, disputed): both
// rows alike.
export function ScoreBoard({
  teams,
  sets,
  winner = null,
  label = "Eredmény",
}: {
  teams: readonly [React.ReactNode, React.ReactNode];
  // Games per set, [team 1, team 2]; a super tie-break is a set too.
  sets: readonly (readonly [number, number])[];
  winner?: 0 | 1 | null;
  label?: string;
}) {
  return (
    <div role="table" aria-label={label} className="flex flex-col gap-1.5">
      {teams.map((team, side) => {
        const won = winner === side;
        const lost = winner !== null && !won;
        return (
          <div
            role="row"
            key={side}
            className="grid items-center gap-1.5"
            style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${sets.length}, 44px)` }}
          >
            <span role="rowheader" className={cn("min-w-0 text-body break-words", won && "font-bold", lost && "text-muted-foreground")}>
              {team}
              {won && <span className="ml-1.5 text-[11px] font-extrabold text-success uppercase">Nyert</span>}
            </span>
            {sets.map((set, i) => (
              <span
                role="cell"
                key={i}
                className={cn(
                  "type-display grid h-12 place-items-center rounded-[10px] text-[26px] tabular-nums",
                  won ? "bg-surface-4 text-foreground" : "bg-surface-2",
                  lost && "text-muted-foreground",
                )}
              >
                {set[side]}
              </span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

import { formatDate, formatDeadline, formatShortDate } from "~/lib/format";

// A season's 4 phases ("körök") with their dates and deadlines, and the
// season's end. Shared by the organizer's season page (list and live preview)
// and the player's home page, which marks the round being played (D139).

export type PhaseDates = { number: number; startsAt: Date; deadline: Date };

/** The round being played at `now`: started and its deadline not passed; null between or outside rounds. */
export function currentPhase(phases: readonly PhaseDates[], now: Date): number | null {
  return phases.find((p) => p.startsAt <= now && now <= p.deadline)?.number ?? null;
}

export function PhaseList({ phases, compact = false, current = null }: { phases: PhaseDates[]; compact?: boolean; current?: number | null }) {
  const last = phases[phases.length - 1];
  return (
    <div className="grid gap-2">
      <ol className="grid gap-1">
        {phases.map((p) => (
          <li
            key={p.number}
            aria-current={p.number === current ? "true" : undefined}
            className={p.number === current ? "-mx-2 flex flex-wrap items-center gap-x-2 rounded-md bg-nav-active-bg px-2 py-1 text-nav-active" : "flex flex-wrap gap-x-2"}
          >
            <span className="font-medium">{p.number}. kör:</span>
            <span>
              {formatShortDate(p.startsAt)} – {formatShortDate(p.deadline)}
            </span>
            {!compact && <span className={p.number === current ? undefined : "text-muted-foreground"}>határidő: {formatDeadline(p.deadline)}</span>}
            {p.number === current && <span className="rounded-full bg-nav-active px-2 py-px text-[10px] font-bold tracking-wide text-white uppercase">most</span>}
          </li>
        ))}
      </ol>
      {last && !compact && (
        <p>
          <span className="font-medium">Szezon vége:</span> {formatDate(last.deadline)}
        </p>
      )}
    </div>
  );
}

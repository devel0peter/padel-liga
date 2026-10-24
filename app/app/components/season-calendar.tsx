import { formatDate, formatDeadline, formatShortDate } from "~/lib/format";

// A season's 4 phases ("körök") with their dates and deadlines, and the
// season's end. Shared by the organizer's season page (list and live preview)
// and the player's home page.

export type PhaseDates = { number: number; startsAt: Date; deadline: Date };

export function PhaseList({ phases, compact = false }: { phases: PhaseDates[]; compact?: boolean }) {
  const last = phases[phases.length - 1];
  return (
    <div className="grid gap-2">
      <ol className="grid gap-1">
        {phases.map((p) => (
          <li key={p.number} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{p.number}. kör:</span>
            <span>
              {formatShortDate(p.startsAt)} – {formatShortDate(p.deadline)}
            </span>
            {!compact && <span className="text-muted-foreground">határidő: {formatDeadline(p.deadline)}</span>}
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

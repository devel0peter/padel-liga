import { ListRow } from "./list-card";
import { StatusPill, type StatusTone } from "./status-pill";

// One of the player's matches in a ListCard (D181): its status as a pill
// (with the week), "<opponent> ellen", and on the right the score once there
// is one, else when it is due. Every text comes from the caller.
export function MatchRow({
  status,
  week,
  opponent,
  score,
  when,
  to,
}: {
  status: { tone: StatusTone; label: string };
  // "1. hét".
  week?: string;
  // The opponent team's name (TeamName or text).
  opponent: React.ReactNode;
  // "4:2, 4:1": pair A first, as everywhere (docs/player-ui.md C6).
  score?: string;
  // Shown without a score: "nov. 30. – dec. 6.", "kedd 19:00".
  when?: string;
  to?: string;
}) {
  return (
    <ListRow
      to={to}
      chevron={false}
      trailing={
        score ? (
          <strong className="text-body font-bold tabular-nums">{score}</strong>
        ) : when ? (
          <span className="text-body text-muted-foreground">{when}</span>
        ) : undefined
      }
    >
      <span className="flex flex-col items-start gap-1.5">
        <StatusPill tone={status.tone}>
          {status.label}
          {week && ` · ${week}`}
        </StatusPill>
        <span>{opponent} ellen</span>
      </span>
    </ListRow>
  );
}

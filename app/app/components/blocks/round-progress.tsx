// Where the round stands (D181): round and week, days left to the deadline,
// and a bar of the time gone. Every value comes from the caller, the dates
// already in Hungarian format ("dec. 6., 23:59").
export function RoundProgress({
  round,
  week,
  deadline,
  daysLeft,
  progress,
  note,
}: {
  round: number;
  week?: number | null;
  deadline: string;
  daysLeft: number;
  // The share of the round gone, 0 to 1.
  progress: number;
  // One line under the bar, e.g. "1 / 3 meccsetek kész".
  note?: React.ReactNode;
}) {
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <section aria-label={`${round}. kör`} className="flex flex-col gap-2.5 rounded-2xl bg-surface px-4 py-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-body font-bold">
          {round}. kör{week ? ` · ${week}. hét` : ""}
        </span>
        <span className="text-caption text-muted-foreground">
          <strong className="font-bold text-foreground">{daysLeft > 0 ? `${daysLeft} nap` : "Ma"}</strong> · {deadline}-ig
        </span>
      </div>
      <div
        role="progressbar"
        aria-label="A körből eltelt idő"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-2 overflow-hidden rounded-full bg-surface-3"
      >
        <div className="h-full rounded-full bg-ball" style={{ width: `${percent}%` }} />
      </div>
      {note && <p className="m-0 text-caption text-muted-foreground">{note}</p>}
    </section>
  );
}

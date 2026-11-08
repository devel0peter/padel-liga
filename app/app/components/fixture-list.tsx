import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import type { FixtureMatch, FixtureSide, FixtureWeek } from "~/lib/fixtures";
import { cn } from "~/lib/utils";

// A group's matches by week, like a fixture list (docs/player-ui.md section
// 3, D133): pair A, the score or the time, pair B; the winner in bold; a match
// without a final result says where it stands. The player's own matches link
// to their page. One component for Kezdőlap and the public league page.

const STATE_LABEL: Record<Exclude<FixtureMatch["state"], "final" | "scheduled">, string> = {
  pending: "Megerősítésre vár",
  disputed: "Vitatott",
  open: "Egyeztetés alatt",
};

function Side({ side, won, align, compact }: { side: FixtureSide; won: boolean; align: "left" | "right"; compact: boolean }) {
  return (
    <span
      className={cn(
        "grid min-w-0",
        compact ? "text-xs leading-tight" : "text-[13px] leading-snug sm:text-sm",
        align === "right" ? "text-right" : "text-left",
        won && "font-bold",
        side.mine && "text-nav-active",
      )}
    >
      <span className="break-words">{side.names[0]}</span>
      <span className="break-words">{side.names[1]}</span>
    </span>
  );
}

// "nov. 10., kedd 18:30" -> ["nov. 10., kedd", "18:30"]
function splitWhen(when: string): [string, string] {
  const i = when.lastIndexOf(" ");
  return i > 0 ? [when.slice(0, i), when.slice(i + 1)] : [when, ""];
}

function Middle({ m }: { m: FixtureMatch }) {
  if (m.state === "final" && m.sets) {
    return (
      <span className="grid justify-items-center font-bold tabular-nums" aria-label={`Eredmény: ${m.sets.map(([a, b]) => `${a}:${b}`).join(", ")}`}>
        {m.sets.map(([a, b], i) => (
          <span key={i}>
            {a}:{b}
          </span>
        ))}
        {m.superTieBreak && (
          <span className="text-xs font-semibold text-muted-foreground">
            ({m.superTieBreak[0]}:{m.superTieBreak[1]})
          </span>
        )}
      </span>
    );
  }
  // A final outcome without a score: a dash here, its note under the row.
  if (m.state === "final") return <span className="font-bold text-muted-foreground">–</span>;
  // No time yet: a dash; the state is said under the row (D143), or only to a
  // screen reader while the pairs are still scheduling.
  if (m.state === "scheduled" && m.when) {
    const [day, time] = splitWhen(m.when);
    return (
      <span className="grid justify-items-center text-center text-[11px] leading-tight">
        <span className="text-muted-foreground">{day}</span>
        <span className="text-sm font-bold">{time}</span>
      </span>
    );
  }
  return (
    <span className="font-bold text-muted-foreground">
      <span aria-hidden>–</span>
      {m.state === "open" && <span className="sr-only">{STATE_LABEL.open}</span>}
    </span>
  );
}

// What isn't a score or a time, under the row: waiting for confirmation, or
// disputed (amber), or a final outcome's note (walkover, both lose).
function Caption({ m }: { m: FixtureMatch }) {
  if (m.state === "final") return !m.sets && m.note ? <span className="col-span-3 text-center text-xs font-semibold text-muted-foreground">{m.note}</span> : null;
  if (m.state === "pending" || m.state === "disputed")
    return (
      <span className={cn("col-span-3 text-center text-[11px] font-semibold", m.state === "disputed" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
        {STATE_LABEL[m.state]}
      </span>
    );
  return null;
}

function Row({ m, compact }: { m: FixtureMatch; compact: boolean }) {
  const body = (
    <>
      <Side side={m.a} won={m.winner === "a"} align="right" compact={compact} />
      <span className="grid place-items-center">
        <Middle m={m} />
      </span>
      <Side side={m.b} won={m.winner === "b"} align="left" compact={compact} />
      {/* Under the names, so a long note never squeezes them (D133), nor moves the middle (D143). */}
      <Caption m={m} />
    </>
  );
  // A fixed middle and the same padding on both sides (room for the arrow of
  // a linked row on each), so the score sits exactly in the middle of every row (D143).
  const grid = cn(
    "relative grid items-center gap-x-1.5 gap-y-0.5 border bg-background px-6",
    compact ? "grid-cols-[minmax(0,1fr)_5rem_minmax(0,1fr)] rounded-md py-1 sm:gap-x-2" : "grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] rounded-lg py-2 sm:gap-x-3",
  );
  return (
    <li>
      {m.href ? (
        <Link to={m.href} className={cn(grid, "border-nav-active/40 bg-nav-active-bg/40 no-underline hover:bg-nav-active-bg")}>
          {body}
          <ChevronRight aria-hidden className="absolute top-1/2 right-1 size-4 -translate-y-1/2 text-nav-active" />
          <span className="sr-only">: a meccs oldala</span>
        </Link>
      ) : (
        <div className={grid}>{body}</div>
      )}
    </li>
  );
}

// `compact` (the Tabella's group cards, D143): tighter weeks and rows, and who
// rests goes on the week's own line, so the list is about as tall as the table.
export function FixtureList({ weeks, label = "Meccsek", compact = false }: { weeks: FixtureWeek[]; label?: string; compact?: boolean }) {
  return (
    <div className={cn("grid", compact ? "gap-2.5" : "gap-4")} role="group" aria-label={label}>
      {weeks.map((w) => (
        <section key={w.week} aria-label={`${w.week}. hét`} className={cn("grid", compact ? "gap-1" : "gap-2")}>
          <h4 className={cn("flex flex-wrap items-baseline gap-x-2 font-bold", compact ? "text-xs" : "text-sm")}>
            {w.week}. hét <span className="font-normal text-muted-foreground">{w.range}</span>
            {w.current && <span className="rounded-full bg-court px-2 py-px text-[10px] font-bold tracking-wide text-white uppercase">ez a hét</span>}
            {compact && w.resting && (
              <span className="text-[11px] font-normal text-muted-foreground">
                · pihen: {w.resting[0]} – {w.resting[1]}
              </span>
            )}
          </h4>
          {w.matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ezen a héten nincs meccs.</p>
          ) : (
            <ul className={cn("grid", compact ? "gap-1" : "gap-1.5")}>
              {w.matches.map((m, i) => (
                <Row key={i} m={m} compact={compact} />
              ))}
            </ul>
          )}
          {!compact && w.resting && (
            <p className="text-xs text-muted-foreground">
              Pihen: {w.resting[0]} – {w.resting[1]}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

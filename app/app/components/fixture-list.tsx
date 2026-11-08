import { ChevronRight, Hourglass, TriangleAlert } from "lucide-react";
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

function Middle({ m, compact }: { m: FixtureMatch; compact: boolean }) {
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
    const [when, time] = splitWhen(m.when);
    // Compact: "nov. 9." without the weekday, so the middle stays narrow.
    const day = compact ? when.split(",")[0] : when;
    return (
      <span className="grid justify-items-center text-center text-[11px] leading-tight">
        <span className="text-muted-foreground">{day}</span>
        <span className="text-sm font-bold">{time}</span>
      </span>
    );
  }
  // Waiting for confirmation or disputed: an icon in the middle, its words on
  // hover and for a screen reader, so the row keeps one line (D143).
  if (m.state === "pending" || m.state === "disputed") {
    const Icon = m.state === "pending" ? Hourglass : TriangleAlert;
    return (
      <span title={STATE_LABEL[m.state]} className={cn("grid place-items-center", m.state === "disputed" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        <Icon aria-hidden className="size-4" />
        <span className="sr-only">{STATE_LABEL[m.state]}</span>
      </span>
    );
  }
  return (
    <span className="font-bold text-muted-foreground">
      <span aria-hidden>–</span>
      <span className="sr-only">{STATE_LABEL.open}</span>
    </span>
  );
}

// A final outcome without a score (walkover, both lose) says so under the row.
function Caption({ m }: { m: FixtureMatch }) {
  return m.state === "final" && !m.sets && m.note ? <span className="col-span-3 text-center text-xs font-semibold text-muted-foreground">{m.note}</span> : null;
}

function Row({ m, compact }: { m: FixtureMatch; compact: boolean }) {
  const body = (
    <>
      <Side side={m.a} won={m.winner === "a"} align="right" compact={compact} />
      <span className="grid place-items-center">
        <Middle m={m} compact={compact} />
      </span>
      <Side side={m.b} won={m.winner === "b"} align="left" compact={compact} />
      {/* Under the names, so a long note never squeezes them (D133), nor moves the middle (D143). */}
      <Caption m={m} />
    </>
  );
  // A fixed middle and the same padding on both sides (room for the arrow of
  // a linked row on each), so the score sits exactly in the middle of every row (D143).
  const grid = cn(
    "relative grid items-center gap-x-1.5 gap-y-0.5 border bg-background",
    compact ? "grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] rounded-md px-5 py-1 sm:gap-x-2" : "grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,1fr)] rounded-lg px-6 py-2 sm:gap-x-3",
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

// What the icons in the middle mean, once under a list that has any.
function IconLegend({ weeks }: { weeks: FixtureWeek[] }) {
  const states = new Set(weeks.flatMap((w) => w.matches.map((m) => m.state)));
  if (!states.has("pending") && !states.has("disputed")) return null;
  return (
    <p aria-hidden className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {states.has("pending") && (
        <span className="inline-flex items-center gap-1">
          <Hourglass className="size-3" /> {STATE_LABEL.pending}
        </span>
      )}
      {states.has("disputed") && (
        <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
          <TriangleAlert className="size-3" /> {STATE_LABEL.disputed}
        </span>
      )}
    </p>
  );
}

// The Tabella's group cards (D143): the week as a narrow column beside its
// matches instead of a line above them, and who rests on hover and for a
// screen reader, so the list is about as tall as the table.
function CompactList({ weeks, label }: { weeks: FixtureWeek[]; label: string }) {
  return (
    <div className="grid gap-1.5" role="group" aria-label={label}>
      {weeks.map((w) => {
        const rest = w.resting ? `pihen: ${w.resting[0]} – ${w.resting[1]}` : null;
        return (
          <section key={w.week} aria-label={`${w.week}. hét`} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-1.5">
            <div title={[w.range, rest].filter(Boolean).join(" · ")} className={cn("grid pt-1 text-[11px] leading-tight", w.current ? "text-court" : "text-muted-foreground")}>
              <span className={cn("font-bold", w.current ? "text-court" : "text-foreground")}>{w.week}. hét</span>
              <span>{w.range.split(" – ")[0]}</span>
              {w.current && <span className="font-semibold">ez a hét</span>}
              {rest && <span className="sr-only">{rest}</span>}
            </div>
            {w.matches.length === 0 ? (
              <p className="pt-1 text-xs text-muted-foreground">Ezen a héten nincs meccs.</p>
            ) : (
              <ul className="grid gap-1">
                {w.matches.map((m, i) => (
                  <Row key={i} m={m} compact />
                ))}
              </ul>
            )}
          </section>
        );
      })}
      <IconLegend weeks={weeks} />
    </div>
  );
}

// `compact`: the Tabella's group cards (CompactList).
export function FixtureList({ weeks, label = "Meccsek", compact = false }: { weeks: FixtureWeek[]; label?: string; compact?: boolean }) {
  if (compact) return <CompactList weeks={weeks} label={label} />;
  return (
    <div className="grid gap-4" role="group" aria-label={label}>
      {weeks.map((w) => (
        <section key={w.week} aria-label={`${w.week}. hét`} className="grid gap-2">
          <h4 className="flex flex-wrap items-baseline gap-x-2 text-sm font-bold">
            {w.week}. hét <span className="font-normal text-muted-foreground">{w.range}</span>
            {w.current && <span className="rounded-full bg-court px-2 py-px text-[10px] font-bold tracking-wide text-white uppercase">ez a hét</span>}
          </h4>
          {w.matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ezen a héten nincs meccs.</p>
          ) : (
            <ul className="grid gap-1.5">
              {w.matches.map((m, i) => (
                <Row key={i} m={m} compact={false} />
              ))}
            </ul>
          )}
          {w.resting && (
            <p className="text-xs text-muted-foreground">
              Pihen: {w.resting[0]} – {w.resting[1]}
            </p>
          )}
        </section>
      ))}
      <IconLegend weeks={weeks} />
    </div>
  );
}

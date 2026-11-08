import { ChevronRight, Hourglass, TriangleAlert } from "lucide-react";
import { Link } from "react-router";

import { Tip } from "~/components/tip";
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

function Middle({ m, compact, inLink }: { m: FixtureMatch; compact: boolean; inLink: boolean }) {
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
  // Waiting for confirmation or disputed: an icon in the middle, its words in
  // a CSS tooltip and for a screen reader, so the row keeps one line (D143).
  if (m.state === "pending" || m.state === "disputed") {
    const Icon = m.state === "pending" ? Hourglass : TriangleAlert;
    return (
      <Tip label={STATE_LABEL[m.state]} focusable={!inLink} className={cn("place-items-center p-0.5", m.state === "disputed" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
        <Icon aria-hidden className="size-4" />
        <span className="sr-only">{STATE_LABEL[m.state]}</span>
      </Tip>
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
        <Middle m={m} compact={compact} inLink={!!m.href} />
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

// The Tabella's group cards (D143): each week is a thin centred divider
// ("1. hét · okt. 26. – nov. 1.") above its matches instead of a heading line,
// and who rests shows on hover and to a screen reader, so the list is about
// as tall as the table.
function CompactList({ weeks, label }: { weeks: FixtureWeek[]; label: string }) {
  return (
    <div className="grid gap-2" role="group" aria-label={label}>
      {weeks.map((w) => {
        const rest = w.resting ? `pihen: ${w.resting[0]} – ${w.resting[1]}` : null;
        const head = (
          <>
            <span className={cn("font-bold", !w.current && "text-foreground")}>{w.week}. hét</span> · {w.range}
            {w.current && <span className="font-semibold"> · ez a hét</span>}
          </>
        );
        return (
          <section key={w.week} aria-label={`${w.week}. hét`} className="grid gap-1">
            <div className={cn("flex items-center gap-2 text-[11px] leading-none", w.current ? "text-court" : "text-muted-foreground")}>
              <span aria-hidden className="h-px flex-1 bg-border" />
              {/* Who rests: in a CSS tooltip on the week's label (D143). */}
              {rest ? (
                <Tip label={rest} focusable className="whitespace-nowrap">
                  <span>
                    {head}
                    <span className="sr-only"> · {rest}</span>
                  </span>
                </Tip>
              ) : (
                <span className="whitespace-nowrap">{head}</span>
              )}
              <span aria-hidden className="h-px flex-1 bg-border" />
            </div>
            {w.matches.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground">Ezen a héten nincs meccs.</p>
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
    </div>
  );
}

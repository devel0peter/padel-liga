import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import type { FixtureMatch, FixtureSide, FixtureWeek } from "~/lib/fixtures";
import { cn } from "~/lib/utils";

// A group's matches by week, like a fixture list (docs/player-ui.md section
// 3, D128): pair A, the score or the time, pair B; the winner in bold; a match
// without a final result says where it stands. The player's own matches link
// to their page. One component for Kezdőlap and the public league page.

const STATE_LABEL: Record<Exclude<FixtureMatch["state"], "final" | "scheduled">, string> = {
  pending: "Megerősítésre vár",
  disputed: "Vitatott",
  open: "Egyeztetés alatt",
};

function Side({ side, won, align }: { side: FixtureSide; won: boolean; align: "left" | "right" }) {
  return (
    <span
      className={cn(
        "grid min-w-0 text-[13px] leading-snug sm:text-sm",
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
  if (m.state === "final") return <span className="text-xs font-semibold text-muted-foreground">{m.note}</span>;
  if (m.state === "scheduled" && m.when) {
    const [day, time] = splitWhen(m.when);
    return (
      <span className="grid justify-items-center text-xs leading-tight">
        <span className="text-muted-foreground">{day}</span>
        <span className="text-sm font-bold">{time}</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        "max-w-[4.5rem] rounded-md px-1 py-0.5 text-center text-[10px] leading-tight font-semibold sm:max-w-none sm:px-1.5 sm:text-[11px]",
        m.state === "disputed" ? "bg-amber-100 text-amber-900" : "bg-muted text-muted-foreground",
      )}
    >
      {STATE_LABEL[m.state as keyof typeof STATE_LABEL]}
    </span>
  );
}

function Row({ m }: { m: FixtureMatch }) {
  const body = (
    <>
      <Side side={m.a} won={m.winner === "a"} align="right" />
      <span className="grid min-w-[3.75rem] place-items-center sm:min-w-[4.5rem]">
        <Middle m={m} />
      </span>
      <Side side={m.b} won={m.winner === "b"} align="left" />
    </>
  );
  const grid = "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 rounded-lg border bg-background px-2 py-2 sm:gap-3 sm:px-3";
  return (
    <li>
      {m.href ? (
        <Link to={m.href} className={cn(grid, "relative border-nav-active/40 bg-nav-active-bg/40 pr-6 no-underline hover:bg-nav-active-bg sm:pr-7")}>
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

export function FixtureList({ weeks, label = "Meccsek" }: { weeks: FixtureWeek[]; label?: string }) {
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
                <Row key={i} m={m} />
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

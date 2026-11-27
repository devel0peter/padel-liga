import { Link } from "react-router";

import { StatusPill } from "~/components/blocks";
import type { FixtureMatch, FixtureSide, FixtureWeek } from "~/lib/fixtures";
import { cn } from "~/lib/utils";

// A group's matches by week on the Tabella (docs/player-ui.md section 3, D133;
// direction A, #422, mockup P04): pair A, the score or the time, pair B; the
// winner in bold; a match waiting for its result says so in a pill. The
// player's own matches are on a lighter row and open their page.

const STATE_LABEL = { pending: "Megerősítésre vár", disputed: "Vitatott", open: "Egyeztetés alatt" } as const;

function Side({ side, won, align }: { side: FixtureSide; won: boolean; align: "left" | "right" }) {
  return (
    <span className={cn("min-w-0 text-sm leading-snug break-words", align === "right" ? "text-right" : "text-left", won ? "font-bold" : "text-soft-foreground")}>
      {side.label}
    </span>
  );
}

function Middle({ m }: { m: FixtureMatch }) {
  if (m.state === "final" && m.sets) {
    const sets = [...m.sets, ...(m.superTieBreak ? [m.superTieBreak] : [])];
    return (
      <span className="type-display text-center text-[17px] whitespace-nowrap tabular-nums" aria-label={`Eredmény: ${m.sets.map(([a, b]) => `${a}:${b}`).join(", ")}`}>
        {sets.map(([a, b]) => `${a}:${b}`).join(" · ")}
      </span>
    );
  }
  // A final outcome without a score: a dash here, its note under the row.
  if (m.state === "final") return <span className="text-muted-foreground">–</span>;
  if (m.state === "scheduled" && m.when) {
    const i = m.when.lastIndexOf(" ");
    return (
      <span className="grid justify-items-center text-center leading-tight">
        <span className="text-[11px] text-muted-foreground">{m.when.slice(0, i).split(",")[0]}</span>
        <span className="text-sm font-bold">{m.when.slice(i + 1)}</span>
      </span>
    );
  }
  if (m.state === "pending" || m.state === "disputed")
    return <StatusPill tone={m.state === "pending" ? "warning" : "danger"}>{STATE_LABEL[m.state]}</StatusPill>;
  return (
    <span className="text-muted-foreground">
      <span aria-hidden>–</span>
      <span className="sr-only">{STATE_LABEL.open}</span>
    </span>
  );
}

function Row({ m }: { m: FixtureMatch }) {
  const body = (
    <>
      <Side side={m.a} won={m.winner === "a"} align="left" />
      <span className="grid place-items-center">
        <Middle m={m} />
      </span>
      <Side side={m.b} won={m.winner === "b"} align="right" />
      {m.state === "final" && !m.sets && m.note && <span className="col-span-3 text-center text-xs text-muted-foreground">{m.note}</span>}
    </>
  );
  const grid = "grid min-h-11 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 rounded-[10px] px-3 py-2";
  return (
    <li>
      {m.href ? (
        <Link to={m.href} className={cn(grid, "bg-surface-2 text-inherit no-underline transition-colors hover:bg-surface-3")}>
          {body}
          <span className="sr-only">: a meccs oldala</span>
        </Link>
      ) : (
        <div className={grid}>{body}</div>
      )}
    </li>
  );
}

// Each week: "1. hét · nov. 16. – 22." ("most" on the current one), its
// matches, and who rests in a group of 3.
export function FixtureList({ weeks, label = "Meccsek" }: { weeks: FixtureWeek[]; label?: string }) {
  return (
    <div className="flex flex-col gap-3" role="group" aria-label={label}>
      {weeks.map((w) => (
        <section key={w.week} aria-label={`${w.week}. hét`} className="flex flex-col gap-1.5">
          <p className="m-0 text-caption text-muted-foreground">
            <span className="font-bold text-foreground">{w.week}. hét</span> · {w.range}
            {w.current && <span className="font-bold text-ball"> · most</span>}
            {w.resting && <span> · pihen: {w.resting}</span>}
          </p>
          {w.matches.length === 0 ? (
            <p className="m-0 text-caption text-muted-foreground">Ezen a héten nincs meccs.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {w.matches.map((m, i) => (
                <Row key={i} m={m} />
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

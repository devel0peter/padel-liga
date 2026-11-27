import { Link } from "react-router";

import { SectionLabel, StatusPill } from "~/components/blocks";

import { pairPath, playerPath, type ProfileMatchView, type ProfilePair, type ProfilePerson } from "~/lib/profiles";

// Shared pieces of the pair and player profiles (#36; members only, D112),
// in direction A (#424, mockups P08, P09).

export function PersonLink({ person }: { person: ProfilePerson }) {
  const path = playerPath(person);
  return path ? (
    <Link to={path} className="text-foreground underline decoration-foreground/40 underline-offset-2 hover:decoration-foreground">
      {person.name}
    </Link>
  ) : (
    <span>{person.name}</span>
  );
}

// A pair by its team label, "Kovács / Nagy" (#419), linking its page.
export function PairLink({ pair }: { pair: ProfilePair }) {
  return (
    <Link to={pairPath(pair.id)} className="leading-snug break-words text-inherit no-underline hover:underline">
      {pair.label}
    </Link>
  );
}

// One block of a profile: a section label over its content (D136, D181).
export function Card({ title, children, label }: { title: string; children: React.ReactNode; label?: string }) {
  return (
    <section role="region" aria-label={label ?? title} className="flex flex-col gap-2.5">
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  );
}

// The matches as rows of one card: the verdict as a pill, the opponents, when,
// the score from the pair's side and the Élő-pont change.
export function MatchList({ matches, empty }: { matches: ProfileMatchView[]; empty: string }) {
  if (matches.length === 0) return <p className="m-0 text-muted-foreground">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl bg-surface p-0 [&>li+li]:border-t [&>li+li]:border-hairline">
      {matches.map((m, i) => (
        <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 md:px-5">
          <StatusPill tone={m.verdict === "Győzelem" ? "success" : m.verdict === "Vereség" ? "danger" : "neutral"}>{m.verdict}</StatusPill>
          <span className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
            <span className="text-body">
              <PairLink pair={m.opponents} /> ellen
            </span>
            <span className="text-caption text-muted-foreground">
              {m.when}
              {m.date && `, ${m.date}`}
            </span>
            {m.note && <span className="text-caption text-muted-foreground">{m.note}</span>}
          </span>
          <span className="flex flex-col items-end gap-0.5 text-right">
            <strong className="text-body tabular-nums">{m.result}</strong>
            {m.elo && (
              <span className="text-xs text-muted-foreground" data-testid="elo-change">
                Élő-pont: <strong className={m.elo.delta.startsWith("-") || m.elo.delta.startsWith("−") ? "text-danger" : "text-success"}>{m.elo.delta}</strong> → {m.elo.after}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

// The rating after each rated match as a small line chart, oldest left. A
// list says the same in text (the match list's "Élő-pont" lines).
export function EloChart({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const width = 320;
  const height = 96;
  const pad = 8;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = Math.max(max - min, 1);
  const x = (i: number) => pad + (i * (width - 2 * pad)) / (points.length - 1);
  const y = (v: number) => height - pad - ((v - min) * (height - 2 * pad)) / span;
  const line = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <figure className="grid gap-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-28 w-full text-ball"
        role="img"
        aria-label={`Élő-pont a meccsek után: ${points.join(", ")}`}
      >
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="text-caption text-muted-foreground">
        Induló: {points[0]} · legjobb: {max} · most: {points[points.length - 1]}
      </figcaption>
    </figure>
  );
}

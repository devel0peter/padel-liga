import { Link } from "react-router";

import { pairPath, playerPath, type ProfileMatchView, type ProfilePair, type ProfilePerson } from "~/lib/profiles";

// Shared pieces of the pair and player profiles (#36; members only, D112),
// in the league page's look: cards.

export function PersonLink({ person }: { person: ProfilePerson }) {
  const path = playerPath(person);
  return path ? (
    <Link to={path} className="underline decoration-court/40 underline-offset-2 hover:decoration-court">
      {person.name}
    </Link>
  ) : (
    <span>{person.name}</span>
  );
}

export function PairLink({ pair }: { pair: ProfilePair }) {
  return (
    <Link to={pairPath(pair.id)} className="grid leading-snug underline decoration-court/40 underline-offset-2 hover:decoration-court">
      <span>{pair.players[0].name}</span>
      <span>{pair.players[1].name}</span>
    </Link>
  );
}

export function Card({ title, children, label }: { title: string; children: React.ReactNode; label?: string }) {
  return (
    <section aria-label={label ?? title} className="grid gap-3 rounded-2xl border bg-background p-4 text-foreground sm:p-5">
      <h2 className="font-display text-xl font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

export function MatchList({ matches, empty }: { matches: ProfileMatchView[]; empty: string }) {
  if (matches.length === 0) return <p className="text-muted-foreground">{empty}</p>;
  return (
    <ul className="grid gap-2">
      {matches.map((m, i) => (
        <li key={i} className="grid gap-1 rounded-lg border bg-background px-3 py-2 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3">
          <div className="grid gap-1">
            <span className="text-sm text-muted-foreground">
              {m.when}
              {m.date && `, ${m.date}`}
            </span>
            <span className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-bold text-muted-foreground">ellenfél:</span>
              <PairLink pair={m.opponents} />
            </span>
            {m.note && <span className="text-sm text-muted-foreground">{m.note}</span>}
          </div>
          <div className="grid gap-0.5 sm:text-right">
            <span className="font-semibold">
              <span className={m.verdict === "Győzelem" ? "text-court" : ""}>{m.verdict}</span> · {m.result}
            </span>
            {m.elo && (
              <span className="text-sm" data-testid="elo-change">
                Értékszám: <strong>{m.elo.delta}</strong> → {m.elo.after}
              </span>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// The rating after each rated match as a small line chart, oldest left. A
// list says the same in text (the match list's "Értékszám" lines).
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
        className="h-24 w-full max-w-md text-court"
        role="img"
        aria-label={`Értékszám a meccsek után: ${points.join(", ")}`}
      >
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        {points.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r="3" fill="currentColor" />
        ))}
      </svg>
      <figcaption className="text-sm text-muted-foreground">
        Induló: {points[0]} · legjobb: {max} · most: {points[points.length - 1]}
      </figcaption>
    </figure>
  );
}

import type { LandingBlock } from "~/lib/landing-league";

// Where a league city's league is today and when a new pair can join (#83,
// lib/landing-league.ts). The texts come ready from the loader.
export function LeagueStatus({ city, block }: { city: string; block: LandingBlock }) {
  return (
    <section aria-label={`${city}: a liga állása`} className="grid gap-4 rounded-2xl border-2 border-court bg-background p-6">
      <div className="grid gap-1">
        <span className="text-sm font-extrabold tracking-wider text-muted-foreground uppercase">{city}</span>
        <h3 className="font-display text-2xl font-bold">{block.title}</h3>
      </div>
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
        {block.facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="font-semibold">{block.joining}</p>
    </section>
  );
}

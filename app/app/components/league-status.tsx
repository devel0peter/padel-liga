import { Link } from "react-router";

import { Button } from "~/components/ui/button";
import type { LandingBlock } from "~/lib/landing-league";

// Where a league city's league is today, when a new pair can join, and the
// way in (#83, lib/landing-league.ts). The texts come ready from the loader.
// Registration goes through an account: a logged-in visitor lands on the
// Kezdőlap, where the pair enters the season.
export function LeagueStatus({ city, block }: { city: string; block: LandingBlock }) {
  return (
    <section aria-label={`${city}: a liga állása`} className="grid gap-4 rounded-2xl border-2 border-court bg-background p-5 sm:p-6">
      <div className="grid gap-1">
        <span className="text-sm font-extrabold tracking-wider text-court uppercase">{city} · Padelpárbaj liga</span>
        <h2 className="font-display text-2xl font-bold">{block.title}</h2>
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-[auto_1fr]">
        {block.facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-bold">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="font-semibold">{block.joining}</p>
      <div className="grid justify-items-start gap-1.5">
        <Button
          asChild
          className="h-auto rounded-full bg-ball px-6 py-3 text-base font-bold text-ball-foreground hover:bg-ball/85"
        >
          <Link to="/register">{block.cta}</Link>
        </Button>
        {block.ctaNote && <p className="text-sm text-muted-foreground">{block.ctaNote}</p>}
      </div>
    </section>
  );
}

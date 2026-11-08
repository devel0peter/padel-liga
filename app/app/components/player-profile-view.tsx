import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { EloChart, MatchList } from "~/components/profile-parts";
import { RatingInfo } from "~/components/rating-info";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { pairName, pairPath } from "~/lib/profiles";
import type { PlayerStats } from "~/lib/profiles";
import type { PlayerProfile } from "~/lib/profiles.server";

// A player's profile (docs/player-ui.md P3, P4, D136): the summary, the
// Élő-pont chart, the pairs and the matches. The same view on /players/<id>
// and on the player's own Profil, "Játékosprofil" tab (`own`: their own
// Élő-pont with its explanation, also before the league starts).

function Stat({ label, value, children, testId }: { label: string; value: React.ReactNode; children?: React.ReactNode; testId?: string }) {
  return (
    <div className="grid content-start gap-0.5 rounded-xl bg-card px-3 py-2.5 ring-1 ring-foreground/10">
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {children}
      </dt>
      <dd className="font-display text-2xl font-extrabold tabular-nums" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

// The summary of a player or a pair (D136): Élő-pont, seasons, rounds,
// matches, wins, losses; "–" before the league starts. `rating`: the
// Élő-pont's explanation button, on the player's own profile.
export function ProfileSummary({
  elo,
  stats,
  started,
  rating,
  eloTestId,
}: {
  elo: number | null;
  stats: PlayerStats | null;
  started: boolean;
  rating?: React.ReactNode;
  eloTestId?: string;
}) {
  const shown = (n: number | undefined) => (started && n != null ? n : "–");
  return (
    <dl className="grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Összesítő">
      <Stat label="Élő-pont" value={elo ?? "–"} testId={eloTestId}>
        {rating}
      </Stat>
      <Stat label="Szezon" value={shown(stats?.seasons)} />
      <Stat label="Kör" value={shown(stats?.rounds)} />
      <Stat label="Meccs" value={shown(stats?.matches)} />
      <Stat label="Győzelem" value={shown(stats?.wins)} />
      <Stat label="Vereség" value={shown(stats?.losses)} />
    </dl>
  );
}

export function PlayerProfileView({
  profile: p,
  own,
}: {
  profile: PlayerProfile | null;
  own?: { rating: number | null; rated: boolean };
}) {
  const elo = own ? own.rating : (p?.elo ?? null);
  const started = !!p?.started;
  return (
    <div className="grid gap-6">
      <ProfileSummary
        elo={elo}
        stats={p?.stats ?? null}
        started={started}
        eloTestId={own ? "rating" : elo != null ? "player-elo" : undefined}
        rating={own && own.rating != null ? <RatingInfo rating={own.rating} rated={own.rated} compact /> : undefined}
      />

      {!p ? (
        <p className="text-muted-foreground">Amint csoportba kerültök, itt látod a meccseidet és a statisztikádat.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <Card role="region" aria-label="Meccsek">
            <CardHeader>
              <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">Meccsek</CardTitle>
            </CardHeader>
            <CardContent>
              {started ? (
                <MatchList matches={p.matches} empty={own ? "Még nincs lejátszott meccsed." : "Még nincs lejátszott meccse."} />
              ) : (
                <p className="text-muted-foreground">Az eredmények és az Élő-pont a liga indulása után látszanak itt.</p>
              )}
            </CardContent>
          </Card>
          <div className="grid gap-6">
            {started && p.eloHistory.length > 1 && (
              <Card role="region" aria-label="Élő-pont alakulása">
                <CardHeader>
                  <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">Élő-pont alakulása</CardTitle>
                </CardHeader>
                <CardContent>
                  <EloChart points={p.eloHistory} />
                </CardContent>
              </Card>
            )}
            <Card role="region" aria-label={own ? "Párosod" : "Párosa"}>
              <CardHeader>
                <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">
                  {own ? (p.pairs.length > 1 ? "Párosaid" : "Párosod") : p.pairs.length > 1 ? "Párosai" : "Párosa"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2">
                  {p.pairs.map((x) => (
                    <li key={x.pair.id}>
                      {/* The pair's page: its results and its own summary. */}
                      <Link
                        to={pairPath(x.pair.id)}
                        className="flex items-center gap-2 rounded-lg border px-3 py-2 text-foreground no-underline hover:bg-muted/50"
                      >
                        <span className="grid min-w-0 flex-1 gap-0.5">
                          <span className="font-semibold break-words">{pairName(x.pair)}</span>
                          <span className="text-sm text-muted-foreground">
                            {x.league}, {x.latest.season}, {x.latest.phase}. kör: {x.latest.group}. csoport ({x.latest.division})
                          </span>
                          <span className="text-sm font-semibold text-nav-active">A pár oldala</span>
                        </span>
                        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

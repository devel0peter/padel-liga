import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { EloChart, MatchList } from "~/components/profile-parts";
import { RatingInfo } from "~/components/rating-info";
import { SectionLabel, TeamBadge } from "~/components/blocks";
import { pairPath } from "~/lib/profiles";
import type { PlayerStats } from "~/lib/profiles";
import type { PlayerProfile } from "~/lib/profiles.server";
import { badgeInitials } from "~/lib/names";
import { cn } from "~/lib/utils";

// A player's profile (docs/player-ui.md P3, P4, D136): the summary, the
// Élő-pont chart, the pairs and the matches. The same view on /players/<id>
// and on the player's own Profil, "Játékosprofil" tab (`own`: their own
// Élő-pont with its explanation, also before the league starts).

// One number of the summary as a tile (D181); the first, the Élő-pont, large and yellow.
function Stat({
  label,
  value,
  children,
  testId,
  big = false,
}: {
  label: string;
  value: React.ReactNode;
  children?: React.ReactNode;
  testId?: string;
  big?: boolean;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5 rounded-[14px] bg-surface p-3", big && "col-span-3 sm:col-span-2 [[data-narrow]_&]:sm:col-span-3")}>
      <dt className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        {children}
      </dt>
      <dd className={cn("type-display m-0 tabular-nums", big ? "text-[44px] leading-none text-ball" : "text-[26px]")} data-testid={testId}>
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
  narrow = false,
}: {
  // A narrow column (the pair page): three tiles a row.
  narrow?: boolean;
  elo: number | null;
  stats: PlayerStats | null;
  started: boolean;
  rating?: React.ReactNode;
  eloTestId?: string;
}) {
  const shown = (n: number | undefined) => (started && n != null ? n : "–");
  return (
    <dl data-narrow={narrow || undefined} className={cn("m-0 grid grid-cols-3 gap-2", !narrow && "sm:grid-cols-7")} aria-label="Összesítő">
      <Stat label="Élő-pont" value={elo ?? "–"} testId={eloTestId} big>
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
        <p className="m-0 text-muted-foreground">Amint csoportba kerültök, itt látod a meccseidet és a statisztikádat.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
          <section role="region" aria-label="Meccsek" className="flex flex-col gap-2.5">
            <SectionLabel>Lejátszott meccsek</SectionLabel>
            {started ? (
              <MatchList matches={p.matches} empty={own ? "Még nincs lejátszott meccsed." : "Még nincs lejátszott meccse."} />
            ) : (
              <p className="m-0 text-muted-foreground">Az eredmények és az Élő-pont a liga indulása után látszanak itt.</p>
            )}
          </section>
          <div className="grid gap-6">
            {started && p.eloHistory.length > 1 && (
              <section role="region" aria-label="Élő-pont alakulása" className="flex flex-col gap-3 rounded-2xl bg-surface p-4 md:p-5">
                <SectionLabel>Élő-pont alakulása</SectionLabel>
                <EloChart points={p.eloHistory} />
              </section>
            )}
            <section role="region" aria-label={own ? "Párosod" : "Párosa"} className="flex flex-col gap-2.5">
              <SectionLabel>{own ? (p.pairs.length > 1 ? "Párosaid" : "Párosod") : p.pairs.length > 1 ? "Párosai" : "Párosa"}</SectionLabel>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {p.pairs.map((x) => (
                  <li key={x.pair.id}>
                    {/* The pair's page: its results and its own summary. */}
                    <Link
                      to={pairPath(x.pair.id)}
                      className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3.5 text-foreground no-underline transition-colors hover:bg-surface-2/60 md:px-5"
                    >
                      <TeamBadge pairId={x.pair.id} initials={[badgeInitials(x.pair.players[0]), badgeInitials(x.pair.players[1])]} size={40} />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="type-display text-xl break-words">{x.pair.label}</span>
                        <span className="text-caption text-muted-foreground">
                          {x.league}, {x.latest.season}, {x.latest.phase}. kör: {x.latest.group}. csoport ({x.latest.division})
                        </span>
                      </span>
                      <ChevronRight aria-hidden className="size-5 shrink-0 text-ball" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

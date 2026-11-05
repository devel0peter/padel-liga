import type { Route } from "./+types/player-profile";
import { Card, EloChart, MatchList, PairLink } from "~/components/profile-parts";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { playerProfile } from "~/lib/profiles.server";
import { pageMeta } from "~/lib/site";

// A player's public profile (#36, spec sections 11, 14, 17): name, current
// értékszám, its history and the final matches. Names and ratings only: no
// email or phone is selected on the way here. A deleted or anonymized
// account has none (404).
export async function loader({ params }: Route.LoaderArgs) {
  const profile = await playerProfile(params.id ?? "");
  if (!profile) throw new Response("Nincs ilyen játékos.", { status: 404 });
  return profile;
}

export function meta({ loaderData, location }: Route.MetaArgs) {
  const name = loaderData?.player.name ?? "Játékos";
  return pageMeta({
    title: `${name} – Padelpárbaj`,
    description:
      loaderData?.elo != null
        ? `${name} a Padelpárbaj ligában: értékszám ${loaderData.elo}, eredmények és csoportok.`
        : `${name} a Padelpárbaj ligában: párja és csoportja.`,
    path: location.pathname,
  });
}

export default function PlayerProfile({ loaderData: d }: Route.ComponentProps) {
  return (
    <>
      <SiteHeader />
      <main className="py-8">
        <Wrap className="grid max-w-4xl gap-6">
          <div className="grid gap-1">
            <span className="text-sm font-extrabold tracking-wider text-court uppercase">Játékos</span>
            <h1 className="font-display text-[clamp(2rem,5vw,3rem)] font-black">{d.player.name}</h1>
            {d.elo != null && (
              <p className="text-lg" data-testid="player-elo">
                Értékszám: <strong className="font-display text-2xl font-extrabold">{d.elo}</strong>
              </p>
            )}
          </div>

          <Card title={d.pairs.length > 1 ? "Párjai" : "Párja"}>
            <ul className="grid gap-3">
              {d.pairs.map((p) => (
                <li key={p.pair.id} className="grid gap-1">
                  <PairLink pair={p.pair} />
                  <span className="text-sm text-muted-foreground">
                    {p.league}, {p.latest.season}, {p.latest.phase}. kör: {p.latest.group}. csoport ({p.latest.division})
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {d.started ? (
            <>
              {d.eloHistory.length > 1 && (
                <Card title="Értékszám alakulása">
                  <EloChart points={d.eloHistory} />
                </Card>
              )}
              <Card title="Meccsek">
                <MatchList matches={d.matches} empty="Még nincs lejátszott meccse." />
              </Card>
            </>
          ) : (
            <p className="text-muted-foreground">Az eredmények és az értékszám a liga indulása után látszanak itt.</p>
          )}
        </Wrap>
      </main>
      <SiteFooter />
    </>
  );
}

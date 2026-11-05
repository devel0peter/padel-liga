import { Link } from "react-router";

import type { Route } from "./+types/pair-profile";
import { Card, MatchList, PersonLink } from "~/components/profile-parts";
import { SiteFooter, SiteHeader, Wrap } from "~/components/site";
import { pairName } from "~/lib/profiles";
import { pairProfile } from "~/lib/profiles.server";
import { pageMeta } from "~/lib/site";

// A pair's public profile (#36, spec sections 14, 17): its two players, its
// group in every phase and its final results. Names only: no email or phone
// is selected on the way here.
export async function loader({ params }: Route.LoaderArgs) {
  const profile = await pairProfile(Number(params.id));
  if (!profile) throw new Response("Nincs ilyen pár.", { status: 404 });
  return profile;
}

export function meta({ loaderData, location }: Route.MetaArgs) {
  const name = loaderData ? pairName(loaderData.pair) : "Pár";
  return pageMeta({
    title: `${name} – Padelpárbaj`,
    description: `${name}: csoportok és eredmények a Padelpárbaj ligában.`,
    path: location.pathname,
  });
}

export default function PairProfile({ loaderData: d }: Route.ComponentProps) {
  return (
    <>
      <SiteHeader />
      <main className="py-8">
        <Wrap className="grid max-w-4xl gap-6">
          <div className="grid gap-1">
            <Link
              to={`/league/${d.league.slug}`}
              className="text-sm font-extrabold tracking-wider text-court uppercase underline-offset-2 hover:underline"
            >
              {d.league.name}
            </Link>
            <h1 className="font-display grid text-[clamp(2rem,5vw,3rem)] leading-tight font-black">
              <PersonLink person={d.pair.players[0]} />
              <PersonLink person={d.pair.players[1]} />
            </h1>
          </div>

          <Card title="Csoportok">
            <ul className="grid gap-2">
              {d.groups.map((g) => (
                <li
                  key={`${g.season}-${g.phase}`}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-lg border px-3 py-2"
                >
                  <span>
                    <span className="text-muted-foreground">
                      {g.season}, {g.phase}. kör:
                    </span>{" "}
                    <strong>{g.group}. csoport</strong> <span className="text-sm text-muted-foreground">({g.division})</span>
                  </span>
                  <span className="text-sm font-semibold">
                    {g.withdrawn ? "visszalépett" : g.place != null ? `${g.place}. hely` : "még nem indult"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {d.started ? (
            <Card title="Meccsek">
              <MatchList matches={d.matches} empty="Még nincs lejátszott meccsük." />
            </Card>
          ) : (
            <p className="text-muted-foreground">Az eredmények a liga indulása után látszanak itt.</p>
          )}
        </Wrap>
      </main>
      <SiteFooter />
    </>
  );
}

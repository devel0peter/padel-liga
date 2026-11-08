import type { Route } from "./+types/pair-profile";
import { AppPage } from "~/components/app-page";
import { Card, MatchList, PersonLink } from "~/components/profile-parts";
import { ProfileSummary } from "~/components/player-profile-view";
import { requireUser } from "~/lib/auth/session.server";
import { pairName } from "~/lib/profiles";
import { pairProfile } from "~/lib/profiles.server";
import { SITE_NAME } from "~/lib/site";

// A pair's profile (#36, spec sections 14, 17): its two players, the summary
// (D136: the pair's Élő-pont, seasons, rounds, matches, wins, losses), its
// group in every phase and its final results. For logged-in members only (D112):
// a visitor goes to the login page and comes back. Names only: no email or
// phone is selected on the way here.
export async function loader({ request, params }: Route.LoaderArgs) {
  await requireUser(request);
  const profile = await pairProfile(Number(params.id));
  if (!profile) throw new Response("Nincs ilyen pár.", { status: 404 });
  return profile;
}

// Not for search engines or link previews (D112): a title only.
export function meta({ loaderData }: Route.MetaArgs) {
  const name = loaderData ? pairName(loaderData.pair) : "Pár";
  return [{ title: `${name} – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export default function PairProfile({ loaderData: d }: Route.ComponentProps) {
  return (
    <AppPage
      back={{ to: `/league/${d.league.slug}`, label: "Tabella" }}
      title={
        <span className="grid leading-tight">
          <PersonLink person={d.pair.players[0]} />
          <PersonLink person={d.pair.players[1]} />
        </span>
      }
    >
      <div className="grid max-w-4xl gap-6">
        <ProfileSummary elo={d.elo} stats={d.stats} started={d.started} eloTestId={d.elo != null ? "pair-elo" : undefined} />
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
      </div>
    </AppPage>
  );
}

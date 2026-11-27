import type { Route } from "./+types/pair-profile";
import { Page, PageHeader, TeamBadge } from "~/components/blocks";
import { Card, MatchList, PersonLink } from "~/components/profile-parts";
import { ProfileSummary } from "~/components/player-profile-view";
import { requireUser } from "~/lib/auth/session.server";
import { badgeInitials } from "~/lib/names";
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
  const name = loaderData ? loaderData.pair.label : "Pár";
  return [{ title: `${name} – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

export default function PairProfile({ loaderData: d }: Route.ComponentProps) {
  const [a, b] = d.pair.players;
  return (
    <Page>
      <div className="flex items-end gap-4">
        <TeamBadge pairId={d.pair.id} initials={[badgeInitials(a), badgeInitials(b)]} size={56} on="ground" className="mb-1" />
        <div className="min-w-0 flex-1">
          <PageHeader
            back={{ to: `/league/${d.league.slug}`, label: "Tabella" }}
            // The team label (#419); the full names stay as the sub-line, each linking its profile.
            title={d.pair.label}
          />
        </div>
      </div>
      <p className="-mt-2 m-0 text-body" data-testid="pair-players">
        <PersonLink person={a} /> és <PersonLink person={b} />
      </p>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start">
        <div className="flex flex-col gap-6">
          <ProfileSummary narrow elo={d.elo} stats={d.stats} started={d.started} eloTestId={d.elo != null ? "pair-elo" : undefined} />
          <p className="-mt-4 m-0 text-caption text-muted-foreground">A pár Élő-pontja a két játékos átlaga.</p>
          <Card title="Csoportok">
            <ul className="m-0 flex list-none flex-col overflow-hidden rounded-2xl bg-surface p-0 [&>li+li]:border-t [&>li+li]:border-hairline">
              {d.groups.map((g) => (
                <li key={`${g.season}-${g.phase}`} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3 md:px-5">
                  <span>
                    <span className="text-muted-foreground">
                      {g.season}, {g.phase}. kör:
                    </span>{" "}
                    <strong>{g.group}. csoport</strong> <span className="text-sm text-muted-foreground">({g.division})</span>
                  </span>
                  <span className="text-sm font-bold">{g.withdrawn ? "visszalépett" : g.place != null ? `${g.place}. hely` : "még nem indult"}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
        {d.started ? (
          <Card title="Meccsek">
            <MatchList matches={d.matches} empty="Még nincs lejátszott meccsük." />
          </Card>
        ) : (
          <p className="m-0 text-muted-foreground">Az eredmények a liga indulása után látszanak itt.</p>
        )}
      </div>
    </Page>
  );
}

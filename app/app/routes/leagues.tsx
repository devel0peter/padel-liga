import type { Route } from "./+types/leagues";
import { Page, PageHeader } from "~/components/blocks";
import { ChooseLeague } from "~/components/choose-league";
import { LeagueCard } from "~/components/league-card";
import { requireUser } from "~/lib/auth/session.server";
import { leagueChoices } from "~/lib/league-members.server";
import { myLeagueCards, myLeaguesAction, withOrigin } from "~/lib/my-leagues.server";
import { SITE_NAME } from "~/lib/site";

// Ligáim (#394): the player's leagues, one card each with a short summary,
// newest season first; with one league its card alone. In no league: the
// same "Melyik ligában játszol?" card as Kezdőlap. One league's card alone
// is /leagues/<league> (leagues.league.tsx).

export function meta({}: Route.MetaArgs) {
  return [{ title: `Ligáim – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const now = new Date();
  const origin = new URL(request.url).origin;
  const cards = (await myLeagueCards(user, now)).map((c) => withOrigin(c, origin));
  const choices = cards.length === 0 ? await leagueChoices(user.id, now) : [];
  return { cards, choices: choices.map((c) => ({ id: c.id, city: c.cityName, name: c.name })) };
}

export async function action({ request }: Route.ActionArgs) {
  return myLeaguesAction(await requireUser(request), await request.formData());
}

export default function MyLeagues({ loaderData: d, actionData }: Route.ComponentProps) {
  const several = d.cards.length > 1;
  const [only] = d.cards;
  // One league: its card alone, the league as the title (#423, mockup P06).
  return (
    <Page>
      <PageHeader
        eyebrow={!several && only ? ["Ligáim", only.season?.name].filter(Boolean).join(" · ") : undefined}
        title={!several && only ? only.league.name : "Ligáim"}
      />
      {d.cards.length === 0 &&
        (d.choices.length > 0 ? (
          <ChooseLeague choices={d.choices} offered={false} />
        ) : (
          <p className="m-0 text-muted-foreground">Még nem vagy egyik ligában sem.</p>
        ))}
      {several ? (
        <ul aria-label="Ligáim" className="m-0 flex list-none flex-col gap-10 p-0">
          {d.cards.map((card) => (
            <li key={card.league.slug}>
              <LeagueCard card={card} actionData={actionData} link={`/leagues/${card.league.slug}`} />
            </li>
          ))}
        </ul>
      ) : (
        only && <LeagueCard card={only} actionData={actionData} />
      )}
    </Page>
  );
}

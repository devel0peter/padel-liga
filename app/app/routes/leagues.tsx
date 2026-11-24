import type { Route } from "./+types/leagues";
import { AppPage } from "~/components/app-page";
import { ChooseLeague } from "~/components/choose-league";
import { LeagueCard } from "~/components/league-card";
import { requireUser } from "~/lib/auth/session.server";
import { leagueChoices } from "~/lib/league-members.server";
import { myLeagueCards, myLeaguesAction } from "~/lib/my-leagues.server";
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
  const cards = await myLeagueCards(user, now);
  const choices = cards.length === 0 ? await leagueChoices(user.id, now) : [];
  return { cards, choices: choices.map((c) => ({ id: c.id, city: c.cityName, name: c.name })) };
}

export async function action({ request }: Route.ActionArgs) {
  return myLeaguesAction(await requireUser(request), await request.formData());
}

export default function MyLeagues({ loaderData: d, actionData }: Route.ComponentProps) {
  const several = d.cards.length > 1;
  return (
    <AppPage title="Ligáim">
      {d.cards.length === 0 &&
        (d.choices.length > 0 ? (
          <ChooseLeague choices={d.choices} offered={false} />
        ) : (
          <p className="text-muted-foreground">Még nem vagy egyik ligában sem.</p>
        ))}
      {several ? (
        <ul aria-label="Ligáim" className="grid gap-6 lg:grid-cols-2 lg:items-start">
          {d.cards.map((card) => (
            <li key={card.league.slug} className="grid">
              <LeagueCard card={card} actionData={actionData} link={`/leagues/${card.league.slug}`} />
            </li>
          ))}
        </ul>
      ) : (
        d.cards[0] && <LeagueCard card={d.cards[0]} actionData={actionData} />
      )}
    </AppPage>
  );
}

import { Form, useNavigation } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { CHOOSE_LEAGUE_BUTTON, CHOOSE_LEAGUE_TEXT, CHOOSE_LEAGUE_TITLE, OFFER_LEAGUE_TEXT, OFFER_LEAGUE_TITLE } from "~/lib/league-members";

export type LeagueChoice = { id: number; city: string; name: string };

// "Melyik ligában játszol?" (#331): for an account in no league, one row per
// league with a season open for entries or running. On Kezdőlap and on
// Ligáim (#394); the form posts intent "join_league" to the page's own action.
export function ChooseLeague({ choices, offered }: { choices: LeagueChoice[]; offered: boolean }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Card className="max-w-2xl border-nav-active">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg">{offered ? OFFER_LEAGUE_TITLE : CHOOSE_LEAGUE_TITLE}</CardTitle>
        <CardDescription>{offered ? OFFER_LEAGUE_TEXT : CHOOSE_LEAGUE_TEXT}</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-3">
          {choices.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-3">
              <span>
                <span className="font-semibold">{c.city}</span>
                <span className="block text-sm text-muted-foreground">{c.name}</span>
              </span>
              <Form method="post">
                <input type="hidden" name="intent" value="join_league" />
                <input type="hidden" name="league" value={c.id} />
                <Button type="submit" disabled={busy}>
                  {CHOOSE_LEAGUE_BUTTON}
                </Button>
              </Form>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

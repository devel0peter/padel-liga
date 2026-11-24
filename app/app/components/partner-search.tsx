import { Link, useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import {
  FINDER_OPEN,
  FINDER_SWITCH_ON,
  PARTNER_SEARCH_LABEL,
  PARTNER_SEARCH_OFF,
  PARTNER_SEARCH_ON,
  PARTNER_SEARCH_ORGANIZER_ONLY,
  PARTNER_SEARCH_TITLE,
  type SearchState,
} from "~/lib/partner-search";

// "Párt keresek" (D59) on Kezdőlap and in Profil's Párod section (D141),
// while the player has no pair in the league: on, Játékosok lists them for
// the organizer and, switched on under this wording, Párkereső for the
// league's other seekers (#398, D177). The switch posts to Profil's action
// wherever it is shown. `bare`: inside a card of its own page, so no card
// around it. `finder`: the league's Párkereső, linked under the text.

type Fetcher = ReturnType<typeof useFetcher>;

const post = (fetcher: Fetcher, leagueId: number, seeking: boolean) =>
  fetcher.submit({ intent: "partner_search", league: String(leagueId), seeking: seeking ? "1" : "0" }, { method: "post", action: "/profile" });

/** "Bekapcsolom a párkeresést": the player's own switch-on under the #398 wording. */
export function SwitchOnButton({ leagueId }: { leagueId: number }) {
  const fetcher = useFetcher();
  return (
    <Button type="button" className="h-11 w-fit px-5" disabled={fetcher.state !== "idle"} onClick={() => post(fetcher, leagueId, true)}>
      {FINDER_SWITCH_ON}
    </Button>
  );
}

export function PartnerSearchBox({ leagueId, search, finder, bare = false }: { leagueId: number; search: SearchState; finder?: string; bare?: boolean }) {
  const fetcher = useFetcher();
  // Shown as switched while the request runs; the player's own switch-on lists them.
  const pending = fetcher.formData?.get("seeking");
  const on = pending != null ? pending === "1" : search.seeking;
  const listed = pending != null ? pending === "1" : search.listed;
  const id = `partner-search-${leagueId}`;
  const control = (
    <div className="flex items-center gap-3">
      <Switch id={id} checked={on} onCheckedChange={(next) => post(fetcher, leagueId, next)} />
      <Label htmlFor={id} className="text-base">
        {PARTNER_SEARCH_LABEL}
      </Label>
    </div>
  );
  const text = !on ? PARTNER_SEARCH_OFF : listed ? PARTNER_SEARCH_ON : PARTNER_SEARCH_ORGANIZER_ONLY;
  const more = (
    <>
      {on && !listed && <SwitchOnButton leagueId={leagueId} />}
      {finder && (
        <Link to={finder} className="w-fit font-semibold underline">
          {FINDER_OPEN}
        </Link>
      )}
    </>
  );
  if (bare)
    return (
      <div className="grid content-start gap-3">
        <h3 className="font-display text-base font-bold">{PARTNER_SEARCH_TITLE}</h3>
        {control}
        <p>{text}</p>
        {more}
      </div>
    );
  return (
    <Card className="max-w-2xl">
      <CardHeader className="gap-3">
        <CardTitle className="font-display text-lg">{PARTNER_SEARCH_TITLE}</CardTitle>
        {control}
        <CardDescription className="text-foreground">{text}</CardDescription>
        {more}
      </CardHeader>
    </Card>
  );
}

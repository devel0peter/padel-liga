import { useFetcher } from "react-router";

import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { PARTNER_SEARCH_LABEL, PARTNER_SEARCH_OFF, PARTNER_SEARCH_ON, PARTNER_SEARCH_TITLE } from "~/lib/partner-search";

// "Párt keresek" (D59) on Kezdőlap and in Profil's Párod section (D140),
// while the player has no pair in the league: on, Párkeresők lists them for
// the organizer. The switch posts to Profil's action wherever it is shown.
// `bare`: inside a card of its own page, so no card around it.
export function PartnerSearchBox({ leagueId, seeking, bare = false }: { leagueId: number; seeking: boolean; bare?: boolean }) {
  const fetcher = useFetcher();
  // Shown as switched while the request runs.
  const pending = fetcher.formData?.get("seeking");
  const on = pending != null ? pending === "1" : seeking;
  const id = `partner-search-${leagueId}`;
  const control = (
    <div className="flex items-center gap-3">
      <Switch
        id={id}
        checked={on}
        onCheckedChange={(next) =>
          fetcher.submit({ intent: "partner_search", league: String(leagueId), seeking: next ? "1" : "0" }, { method: "post", action: "/profile" })
        }
      />
      <Label htmlFor={id} className="text-base">
        {PARTNER_SEARCH_LABEL}
      </Label>
    </div>
  );
  const text = on ? PARTNER_SEARCH_ON : PARTNER_SEARCH_OFF;
  if (bare)
    return (
      <div className="grid content-start gap-3">
        <h3 className="font-display text-base font-bold">{PARTNER_SEARCH_TITLE}</h3>
        {control}
        <p>{text}</p>
      </div>
    );
  return (
    <Card className="max-w-2xl">
      <CardHeader className="gap-3">
        <CardTitle className="font-display text-lg">{PARTNER_SEARCH_TITLE}</CardTitle>
        {control}
        <CardDescription className="text-foreground">{text}</CardDescription>
      </CardHeader>
    </Card>
  );
}

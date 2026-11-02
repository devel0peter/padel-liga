import { useFetcher } from "react-router";

import { Card, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { PARTNER_SEARCH_LABEL, PARTNER_SEARCH_OFF, PARTNER_SEARCH_ON, PARTNER_SEARCH_TITLE } from "~/lib/partner-search";

// "Párt keresek" on Párom (D59), while the player has no pair in the league:
// on, Párkeresők lists them for the organizer.
export function PartnerSearchBox({ leagueId, seeking }: { leagueId: number; seeking: boolean }) {
  const fetcher = useFetcher();
  // Shown as switched while the request runs.
  const pending = fetcher.formData?.get("seeking");
  const on = pending != null ? pending === "1" : seeking;
  const id = `partner-search-${leagueId}`;
  return (
    <Card className="max-w-2xl">
      <CardHeader className="gap-3">
        <CardTitle className="font-display text-lg">{PARTNER_SEARCH_TITLE}</CardTitle>
        <div className="flex items-center gap-3">
          <Switch
            id={id}
            checked={on}
            onCheckedChange={(next) =>
              fetcher.submit({ intent: "partner_search", league: String(leagueId), seeking: next ? "1" : "0" }, { method: "post", action: "/pair" })
            }
          />
          <Label htmlFor={id} className="text-base">
            {PARTNER_SEARCH_LABEL}
          </Label>
        </div>
        <CardDescription className="text-foreground">{on ? PARTNER_SEARCH_ON : PARTNER_SEARCH_OFF}</CardDescription>
      </CardHeader>
    </Card>
  );
}

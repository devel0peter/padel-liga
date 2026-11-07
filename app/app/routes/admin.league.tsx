import { data, Form, useNavigation } from "react-router";

import type { Route } from "./+types/admin.league";
import { AppPage } from "~/components/app-page";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { requirePermission } from "~/lib/auth/admin.server";
import { cityName } from "~/lib/cities";
import { listCities } from "~/lib/cities.server";
import { getLeague, minEntriesByLeague, organizersByLeague } from "~/lib/leagues.server";
import { MIN_ENTRIES_RANGE, parseMinEntries } from "~/lib/seasons";
import { setMinEntries, waitingSeasonOf } from "~/lib/season-start.server";
import { listSeasons } from "~/lib/seasons.server";

// A league's home for its Szervezők. Seasons have their own page (Szezonok);
// entries, pairs and groups come here with their own tickets (#23, #24).
// The minimum entries its first season needs to start (D124, #335) is set
// here, while that season waits.

async function leagueScope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league } = await leagueScope(request, params.league);
  const organizers = (await organizersByLeague()).get(league.id)?.active ?? [];
  const [minimums, waiting, seasons] = await Promise.all([
    minEntriesByLeague([league.id]),
    waitingSeasonOf(league.id),
    listSeasons(league.id),
  ]);
  return {
    name: league.name,
    city: cityName(league.city, await listCities()),
    // Names only: co-organizers don't need each other's email here.
    organizers: organizers.map((o) => o.name || "Névtelen"),
    minEntries: minimums.get(league.id) ?? 0,
    // Editable only while the first season waits for it; shown (read-only)
    // only before the league has a season, where it is about to matter.
    minEditable: !!waiting,
    minShown: !!waiting || seasons.length === 0,
  };
}

type ActionData = { error?: string; notice?: string };

export async function action({ request, params }: Route.ActionArgs): Promise<ActionData> {
  const { league, actor } = await leagueScope(request, params.league);
  const form = await request.formData();
  if (form.get("intent") !== "minEntries") throw new Response("Hibás kérés.", { status: 400 });
  const parsed = parseMinEntries(form.get("minEntries"));
  if (!parsed.ok) return { error: parsed.error };
  const result = await setMinEntries(actor, league.id, parsed.value);
  if (!result.ok) return { error: result.error };
  return {
    notice: result.started
      ? "Elmentetted. A nevezések már elérik a minimumot: kiderült a kezdés napja, és a játékosok értesítést kaptak."
      : "Elmentetted a minimumot.",
  };
}

export default function LeagueOverview({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === "submitting";
  return (
    <AppPage title={loaderData.name} description={loaderData.city}>
      <div className="grid gap-1">
        <h2 className="text-sm font-semibold">Szervezők</h2>
        <p>{loaderData.organizers.length ? loaderData.organizers.join(", ") : "Még nincs szervezője."}</p>
      </div>
      {(loaderData.minShown || actionData) && (
        <section className="grid max-w-xl gap-2">
          <h2 className="text-sm font-semibold">Minimum nevezés</h2>
          {loaderData.minEditable ? (
            <Form method="post" className="grid gap-2">
              <input type="hidden" name="intent" value="minEntries" />
              <Label htmlFor="minEntries" className="font-normal text-muted-foreground">
                Az első szezon akkor indul, ha ennyi pár nevezett. Utána már nem módosítható.
              </Label>
              <div className="flex gap-2">
                <Input
                  id="minEntries"
                  name="minEntries"
                  type="number"
                  inputMode="numeric"
                  min={MIN_ENTRIES_RANGE.min}
                  max={MIN_ENTRIES_RANGE.max}
                  defaultValue={loaderData.minEntries}
                  required
                  className="w-24"
                />
                <Button type="submit" disabled={busy}>
                  Mentés
                </Button>
              </div>
            </Form>
          ) : (
            <p className="text-muted-foreground">
              {loaderData.minEntries} pár: ennyi nevezés kell, hogy a liga első szezonja elinduljon, ha a Szezonok oldalon
              így nyitod meg. Addig módosítható, amíg az a szezon a nevezésekre vár.
            </p>
          )}
          {actionData && (
            <p
              role={actionData.error ? "alert" : "status"}
              className={actionData.error ? "text-sm font-semibold text-destructive" : "text-sm font-medium"}
            >
              {actionData.error ?? actionData.notice}
            </p>
          )}
        </section>
      )}
      <p className="max-w-xl rounded-lg border border-dashed p-6 text-muted-foreground">
        A nevezések, a párok és a csoportok itt lesznek, amint elkészülnek. A szezonokat a Szezonok oldalon állítod be.
      </p>
    </AppPage>
  );
}

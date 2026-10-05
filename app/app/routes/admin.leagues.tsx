import { ExternalLink, X } from "lucide-react";
import { Form, Link, redirect, useNavigation } from "react-router";

import type { Route } from "./+types/admin.leagues";
import { AppPage } from "~/components/app-page";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requirePermission } from "~/lib/auth/admin.server";
import { isValidEmail, normalizeEmail } from "~/lib/auth/rules";
import { cityName } from "~/lib/cities";
import { listCities } from "~/lib/cities.server";
import { parseLeague, type LeagueField } from "~/lib/leagues";
import {
  cancelOrganizerInvite,
  createLeague,
  getLeague,
  grantOrganizer,
  leagueSlugTaken,
  listLeagues,
  organizersByLeague,
  revokeOrganizer,
} from "~/lib/leagues.server";

// Leagues and their Szervezők (Admin only; docs/admin-plan.md, #18).

export async function loader({ request }: Route.LoaderArgs) {
  await requirePermission(request, { kind: "leagues.manage" });
  const [leagues, organizers, cities] = await Promise.all([listLeagues(), organizersByLeague(), listCities()]);
  return {
    leagues: leagues.map((l) => ({
      ...l,
      cityName: cityName(l.city, cities),
      organizers: organizers.get(l.id)?.active ?? [],
      pending: organizers.get(l.id)?.pending ?? [],
    })),
    cities: cities.map(({ slug, name }) => ({ slug, name })),
  };
}

type ActionData =
  | { intent: "create"; errors: Partial<Record<LeagueField, string>> }
  | { intent: "grant"; league: string; error?: string; message?: string };

const GRANT_MESSAGES = {
  granted: "Kész, mostantól szervező.",
  already: "Már szervező ebben a ligában.",
  invited:
    "Még nincs fiókja. Felvettük: amint ezzel a címmel belép (padelparbaj.hu/login), szervező lesz. E-mailt nem küldünk, szólj neki.",
};

export async function action({ request }: Route.ActionArgs): Promise<ActionData | Response> {
  const actor = await requirePermission(request, { kind: "leagues.manage" });
  const form = await request.formData();
  const intent = form.get("intent");

  if (intent === "create") {
    const result = parseLeague(form, await listCities());
    if (!result.ok) return { intent, errors: result.errors };
    if (await leagueSlugTaken(result.data.slug))
      return { intent, errors: { slug: "Ez az azonosító már egy másik ligáé." } };
    await createLeague(result.data, actor.id);
    return redirect("/admin/leagues");
  }

  const league = await getLeague(String(form.get("league") ?? ""));
  if (!league) throw new Response("Nincs ilyen liga.", { status: 404 });

  if (intent === "grant") {
    const email = normalizeEmail(String(form.get("email") ?? ""));
    if (!isValidEmail(email)) return { intent, league: league.slug, error: "Ez nem tűnik e-mail-címnek." };
    const result = await grantOrganizer(league, email, actor.id);
    return { intent, league: league.slug, message: GRANT_MESSAGES[result] };
  }
  if (intent === "revoke") await revokeOrganizer(league, String(form.get("userId") ?? ""), actor.id);
  if (intent === "cancel-invite") await cancelOrganizerInvite(league, String(form.get("email") ?? ""), actor.id);
  return redirect("/admin/leagues");
}

function RemoveButton({ label, intent, league, name, value }: { label: string; intent: string; league: string; name: string; value: string }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="league" value={league} />
      <input type="hidden" name={name} value={value} />
      <Button type="submit" variant="ghost" size="icon-sm" aria-label={label} title={label}>
        <X />
      </Button>
    </Form>
  );
}

export default function AdminLeagues({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state === "submitting";
  const createErrors = actionData?.intent === "create" ? actionData.errors : {};
  return (
    <AppPage
      title="Ligák"
      description="A ligák és a szervezőik. Akinek még nincs fiókja, azt is felveheted: az első belépésekor lesz szervező (e-mailt nem küldünk)."
    >
      {loaderData.leagues.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          Még nincs liga. Hozd létre az elsőt lent.
        </p>
      )}

      {loaderData.leagues.map((league) => {
        const result = actionData?.intent === "grant" && actionData.league === league.slug ? actionData : null;
        return (
          <section key={league.id} className="grid gap-4 rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-display text-lg font-bold">{league.name}</h2>
                <p className="text-sm text-muted-foreground">
                  {league.cityName} · /{league.slug}
                </p>
              </div>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/admin/leagues/${league.slug}`}>
                  <ExternalLink /> Megnyitás
                </Link>
              </Button>
            </div>

            <div className="grid gap-2">
              <h3 className="text-sm font-semibold">Szervezők</h3>
              {league.organizers.length === 0 && league.pending.length === 0 ? (
                <p className="text-sm text-muted-foreground">Még nincs szervezője.</p>
              ) : (
                <ul className="grid gap-1">
                  {league.organizers.map((o) => (
                    <li key={o.userId} className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{o.name || o.email}</span>
                      <span className="text-muted-foreground">{o.email}</span>
                      <RemoveButton label="Szervező elvétele" intent="revoke" league={league.slug} name="userId" value={o.userId} />
                    </li>
                  ))}
                  {league.pending.map((p) => (
                    <li key={p.email} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">{p.email}</span>
                      <Badge variant="outline">még nem lépett be</Badge>
                      <RemoveButton label="Meghívó visszavonása" intent="cancel-invite" league={league.slug} name="email" value={p.email} />
                    </li>
                  ))}
                </ul>
              )}
              <Form method="post" className="flex flex-wrap items-end gap-2">
                <input type="hidden" name="intent" value="grant" />
                <input type="hidden" name="league" value={league.slug} />
                <div className="grid gap-1.5">
                  <Label htmlFor={`email-${league.id}`} className="sr-only">
                    Szervező e-mail-címe
                  </Label>
                  <Input
                    id={`email-${league.id}`}
                    name="email"
                    type="email"
                    required
                    placeholder="szervezo@example.com"
                    className="w-72 max-w-full"
                  />
                </div>
                <Button type="submit" variant="outline" disabled={busy}>
                  Szervező hozzáadása
                </Button>
              </Form>
              {result?.error && <p className="text-sm font-semibold text-destructive">{result.error}</p>}
              {result?.message && <p className="text-sm">{result.message}</p>}
            </div>
          </section>
        );
      })}

      <Form method="post" className="grid max-w-3xl gap-4 rounded-lg border p-4">
        <input type="hidden" name="intent" value="create" />
        <h2 className="font-display text-lg font-bold">Új liga</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid content-start gap-1.5">
            <Label htmlFor="name">Név</Label>
            <Input id="name" name="name" placeholder="Padelpárbaj Győr" maxLength={80} required />
            {createErrors.name && <p className="text-sm font-semibold text-destructive">{createErrors.name}</p>}
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="slug">Azonosító (a címben)</Label>
            <Input id="slug" name="slug" placeholder="gyor" maxLength={40} />
            <p className="text-xs text-muted-foreground">Üresen hagyva a névből készül. Később ne változtasd.</p>
            {createErrors.slug && <p className="text-sm font-semibold text-destructive">{createErrors.slug}</p>}
          </div>
          <div className="grid content-start gap-1.5">
            <Label htmlFor="city">Város</Label>
            <Select name="city" defaultValue={loaderData.cities[0]?.slug}>
              <SelectTrigger id="city" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {loaderData.cities.map((c) => (
                  <SelectItem key={c.slug} value={c.slug}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {createErrors.city && <p className="text-sm font-semibold text-destructive">{createErrors.city}</p>}
          </div>
        </div>
        <div>
          <Button type="submit" disabled={busy}>
            Liga létrehozása
          </Button>
        </div>
      </Form>
    </AppPage>
  );
}

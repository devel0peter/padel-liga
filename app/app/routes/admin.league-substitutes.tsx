import { data, Form, useNavigation } from "react-router";

import type { Route } from "./+types/admin.league-substitutes";
import { AppPage } from "~/components/app-page";
import { PairNames, PersonLink } from "~/components/person-link";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDeadline, formatSlot } from "~/lib/format";
import { formatElo } from "~/lib/groups";
import { getLeague } from "~/lib/leagues.server";
import { SITE_NAME } from "~/lib/site";
import { SUBSTITUTE_REASON_MAX } from "~/lib/substitutes";
import { decideSubstitute, leagueSubstitutes, type SubstituteDecision, type SubstituteRequest } from "~/lib/substitutes.server";

// Helyettesek (#37, spec 4, D109): the league's substitute requests waiting
// for a decision, with the absent player's and the substitute's current Elo
// side by side (the organizer judges the level), and the approvals that can
// still be revoked (until the match starts). The league's Szervező and the
// Admin only. Names only, no contact data.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Helyettesek – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

async function scope(request: Request, slug: string) {
  const league = await getLeague(slug);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  return { league, actor };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league } = await scope(request, params.league);
  return { league, ...(await leagueSubstitutes(league.id)) };
}

type ActionResult = { ok: boolean; message: string };
const DECISIONS: readonly SubstituteDecision[] = ["approve", "reject", "revoke"];

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor } = await scope(request, params.league);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "") as SubstituteDecision;
  const id = Number(form.get("id"));
  if (!DECISIONS.includes(intent) || !Number.isInteger(id) || id <= 0) throw data("Hibás kérés.", { status: 400 });
  const done = await decideSubstitute(actor.id, league.id, id, intent, String(form.get("reason") ?? ""));
  if (done.ok) return data<ActionResult>({ ok: true, message: done.notice });
  if (done.notFound) throw data(done.error, { status: 404 });
  return data<ActionResult>({ ok: false, message: done.error }, { status: 400 });
}

const where = (r: SubstituteRequest) => `${r.season} · ${r.phase}. kör · ${r.groupNumber}. csoport · ${r.week}. hét`;
const when = (r: SubstituteRequest) => (r.startsAt ? `Kezdés: ${formatSlot(r.startsAt)}` : `Még nincs időpont, határidő: ${formatDeadline(r.closesAt)}`);
const elo = (v: number | null) => (v === null ? "nincs szintje" : formatElo(v));

function Players({ r }: { r: SubstituteRequest }) {
  const diff = r.absent.elo !== null && r.substitute.elo !== null ? r.substitute.elo - r.absent.elo : null;
  return (
    <div className="grid gap-2">
      <dl className="grid grid-cols-2 gap-2" aria-label="Elo">
        <div className="rounded-md bg-muted p-2">
          <dt className="text-xs text-muted-foreground">Hiányzó</dt>
          <dd className="font-medium break-words">
            <PersonLink id={r.absent.id} name={r.absent.name} />
          </dd>
          <dd className="tabular-nums">Elo {elo(r.absent.elo)}</dd>
        </div>
        <div className="rounded-md bg-muted p-2">
          <dt className="text-xs text-muted-foreground">Helyettes</dt>
          <dd className="font-medium break-words">
            <PersonLink id={r.substitute.id} name={r.substitute.name} />
          </dd>
          <dd className="tabular-nums">Elo {elo(r.substitute.elo)}</dd>
        </div>
      </dl>
      {diff !== null && (
        <p className="text-xs text-muted-foreground">
          {diff > 0 ? `A helyettes ${formatElo(diff)} ponttal erősebb.` : diff < 0 ? `A helyettes ${formatElo(-diff)} ponttal gyengébb.` : "Azonos az Elójuk."}
        </p>
      )}
    </div>
  );
}

function Request({ r, children }: { r: SubstituteRequest; children: React.ReactNode }) {
  return (
    <li className="grid gap-3 rounded-lg border p-4 text-sm">
      <div className="grid gap-0.5">
        <p className="text-xs text-muted-foreground">{where(r)}</p>
        <p className="font-medium break-words">Kéri: {r.pair}</p>
        <p className="break-words">Ellenfél: {r.opponents}</p>
        <p className="text-muted-foreground">{when(r)}</p>
      </div>
      <Players r={r} />
      {children}
    </li>
  );
}

export default function LeagueSubstitutes({ loaderData, actionData }: Route.ComponentProps) {
  const { waiting, approved } = loaderData;
  const result = actionData as ActionResult | undefined;
  const busy = useNavigation().state !== "idle";
  return (
    <AppPage
      title="Helyettesek"
      description="A párok helyettes kérései. A helyettes nagyjából azonos vagy gyengébb legyen, mint akit helyettesít: te döntesz."
    >
      {result && (
        <p role={result.ok ? "status" : "alert"} className={result.ok ? "font-medium" : "font-semibold text-destructive"}>
          {result.message}
        </p>
      )}

      <section className="grid max-w-3xl gap-3" aria-labelledby="var">
        <h2 id="var" className="font-display text-lg font-bold">
          Jóváhagyásra vár ({waiting.length})
        </h2>
        {waiting.length === 0 ? (
          <p className="text-sm text-muted-foreground">Most nincs döntésre váró kérés.</p>
        ) : (
          <ul className="grid gap-3">
            {waiting.map((r) => (
              <Request key={r.id} r={r}>
                <Form method="post" className="grid gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <div className="grid gap-1.5">
                    <Label htmlFor={`reason-${r.id}`}>Indoklás elutasításhoz (nem kötelező)</Label>
                    <Textarea id={`reason-${r.id}`} name="reason" maxLength={SUBSTITUTE_REASON_MAX} rows={2} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" name="intent" value="approve" disabled={busy}>
                      Jóváhagyom
                    </Button>
                    <Button type="submit" name="intent" value="reject" variant="outline" disabled={busy}>
                      Elutasítom
                    </Button>
                  </div>
                </Form>
              </Request>
            ))}
          </ul>
        )}
      </section>

      <section className="grid max-w-3xl gap-3" aria-labelledby="jovahagyva">
        <h2 id="jovahagyva" className="font-display text-lg font-bold">
          Jóváhagyva, még nem játszották ({approved.length})
        </h2>
        <p className="text-sm text-muted-foreground">A meccs kezdetéig visszavonhatod. Mindkét pár értesítést kap.</p>
        {approved.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nincs ilyen.</p>
        ) : (
          <ul className="grid gap-3">
            {approved.map((r) => (
              <Request key={r.id} r={r}>
                <Form method="post" className="grid gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  <div className="grid gap-1.5">
                    <Label htmlFor={`revoke-${r.id}`}>Indoklás (nem kötelező, csak a pár látja)</Label>
                    <Textarea id={`revoke-${r.id}`} name="reason" maxLength={SUBSTITUTE_REASON_MAX} rows={2} />
                  </div>
                  <div>
                    <Button type="submit" name="intent" value="revoke" variant="outline" disabled={busy}>
                      Visszavonom
                    </Button>
                  </div>
                </Form>
              </Request>
            ))}
          </ul>
        )}
      </section>
    </AppPage>
  );
}

import { data, Form, useNavigation } from "react-router";

import type { Route } from "./+types/admin.match-decide";
import { AppPage } from "~/components/app-page";
import { FormFeedback, ScoreFields } from "~/components/match-result";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { decideMatch, decisionPage } from "~/lib/decisions.server";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { getLeague } from "~/lib/leagues.server";
import { REASON_MAX } from "@padel-liga/rules";
import { MATCH_LOST_BOTH_TEXT, neutralScoreText, parseOutcome, versusText, type OutcomeChoice } from "~/lib/results";
import { SITE_NAME } from "~/lib/site";

// Deciding a match (#29): a disputed result, or an override of any match of
// the league, played or not, with a required reason. Both pairs' versions
// and the full log are shown. The league's Szervező and the Admin only; a
// match of another league is 404.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Döntés – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

const NOT_FOUND = "Nincs ilyen meccs ebben a ligában.";

async function scope(request: Request, params: { league: string; id: string }) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  const actor = await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw data(NOT_FOUND, { status: 404 });
  return { league, actor, id };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { league, id } = await scope(request, params);
  const page = await decisionPage(league.id, id);
  if (!page) throw data(NOT_FOUND, { status: 404 });
  return { slug: league.slug, page };
}

type ActionResult = { intent: string; ok: boolean; message: string };

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor, id } = await scope(request, params);
  const form = await request.formData();
  const outcome = parseOutcome(form);
  if (!outcome) return data<ActionResult>({ intent: "decide", ok: false, message: "Válassz, mi legyen a meccs kimenetele." }, { status: 400 });
  const done = await decideMatch(actor.id, league.id, id, outcome, String(form.get("reason") ?? ""));
  if (done.ok) return data<ActionResult>({ intent: "decide", ok: true, message: done.notice });
  if (!done.ok && done.notFound) throw data(NOT_FOUND, { status: 404 });
  return data<ActionResult>({ intent: "decide", ok: false, message: done.error }, { status: 400 });
}

export default function MatchDecide({ loaderData, actionData }: Route.ComponentProps) {
  const { slug, page: m } = loaderData;
  const busy = useNavigation().state !== "idle";
  const r = m.result;
  const choices: { value: OutcomeChoice; label: string }[] = [
    { value: "played", label: "Eredmény (lent add meg)" },
    { value: "walkover-a", label: `Játék nélküli győzelem: ${m.a} (4:0, 4:0)` },
    { value: "walkover-b", label: `Játék nélküli győzelem: ${m.b} (4:0, 4:0)` },
    { value: "both-inactive", label: MATCH_LOST_BOTH_TEXT },
    { value: "unplayed", label: "Elmaradt (egyik pár sem kap pontot, nem számít a tabellába)" },
  ];
  const current: OutcomeChoice | undefined = !m.current
    ? undefined
    : m.current.kind === "walkover"
      ? (`walkover-${m.current.winner}` as const)
      : m.current.kind;
  const score = m.current?.kind === "played" ? m.current.score : null;
  return (
    <AppPage
      title={versusText(m.a, m.b)}
      description={`${m.season} · ${m.phase}. kör · ${m.groupNumber}. csoport · ${m.week}. hét · határidő: ${formatDeadline(m.deadline)}`}
      back={{ to: `/admin/leagues/${slug}/disputes`, label: "Viták" }}
    >
      <section className="grid max-w-2xl gap-1 rounded-lg border p-4 text-sm sm:p-6" aria-label="Állapot">
        <p>
          <span className="font-medium">1. pár:</span> {m.a}
        </p>
        <p>
          <span className="font-medium">2. pár:</span> {m.b}
        </p>
        <p className="font-semibold">{m.label}</p>
        {r.status === "disputed" && (
          <>
            <p>
              {r.by === "a" ? m.a : m.b} szerint: <strong>{neutralScoreText(r.score)}</strong>
            </p>
            <p>
              {r.by === "a" ? m.b : m.a} szerint: <strong>{r.counter ? neutralScoreText(r.counter) : "nem adott meg eredményt"}</strong>
            </p>
            {m.note && <p className="break-words">Megjegyzés: {m.note}</p>}
            <p className="text-xs text-muted-foreground">Az eredmények az 1. pár szemszögéből.</p>
          </>
        )}
      </section>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="font-display text-lg">{r.status === "disputed" ? "Döntés a vitában" : "Kimenetel felülbírálása"}</CardTitle>
          <CardDescription>
            A döntésed végleges, és mindkét pár értesítést kap róla. Az indoklás kötelező: a meccs naplójába kerül, a párok is látják.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Keyed by the log, so the form resets after a decision. */}
          <Form key={m.log.length} method="post" className="grid gap-4">
            <RadioGroup name="outcome" defaultValue={current} required aria-label="Kimenetel">
              {choices.map((c) => (
                <div key={c.value} className="flex items-start gap-2">
                  <RadioGroupItem value={c.value} id={`outcome-${c.value}`} className="mt-0.5" />
                  <Label htmlFor={`outcome-${c.value}`} className="font-normal break-words">
                    {c.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            <div className="grid gap-1">
              <p className="text-sm font-medium">Eredmény (csak „Eredmény” esetén)</p>
              <ScoreFields id="decide" columns={["1. pár", "2. pár"]} values={score} required={false} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="reason">Indoklás</Label>
              <Textarea id="reason" name="reason" maxLength={REASON_MAX} rows={3} required />
            </div>
            <FormFeedback result={actionData as ActionResult | undefined} intent="decide" />
            <div>
              <Button type="submit" disabled={busy}>
                Döntés mentése
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      <section className="grid max-w-2xl gap-2" aria-labelledby="naplo">
        <h2 id="naplo" className="font-display text-lg font-bold">
          Napló
        </h2>
        {m.log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Még nem történt semmi.</p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {m.log.map((e) => (
              <li key={e.key} className="grid gap-0.5 rounded-md border p-3">
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(e.at)} · {e.who} ({e.role})
                </span>
                <span className="break-words">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </AppPage>
  );
}

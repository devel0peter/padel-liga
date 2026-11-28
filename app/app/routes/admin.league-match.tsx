import { REASON_MAX } from "@padel-liga/rules";
import { data, Form, useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/admin.league-match";
import { OrganizerAbsences } from "~/components/absences";
import { OverflowRow, Page, PageHeader, SectionLabel } from "~/components/blocks";
import { FormFeedback, ScoreFields } from "~/components/match-result";
import { Contacts, StatusPill } from "~/components/my-group";
import { PairNames, PersonLink } from "~/components/person-link";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { requirePermission } from "~/lib/auth/admin.server";
import { decideMatch, decisionPage } from "~/lib/decisions.server";
import { formatDateTime, formatDeadline, formatSlot } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { getLeague } from "~/lib/leagues.server";
import { STUCK_TEXT } from "~/lib/match-overview";
import { organizerMatch } from "~/lib/match-overview.server";
import { groupLine } from "~/lib/matches";
import { NO_SHOW_REASON_MAX, NO_SHOW_REFUSALS } from "~/lib/no-shows";
import { decideNoShow, leagueNoShows } from "~/lib/no-shows.server";
import { bothLostText, neutralScoreText, parseOutcome, walkoverScoreText, type OutcomeChoice } from "~/lib/results";
import { SITE_NAME } from "~/lib/site";
import { organizerAbsences } from "~/lib/substitutes.server";

// One unified organizer match page (#433): status, pairs & phones (while the
// round runs), absences, inline decision when a dispute or no-show waits (the
// page's one primary yellow action), full log, and override under "•••".

export function meta({}: Route.MetaArgs) {
  return [{ title: `Meccs – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

const NOT_FOUND = "Nincs ilyen meccs.";

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
  const [match, decision, noShows, absent] = await Promise.all([
    organizerMatch(league.id, id),
    decisionPage(league.id, id),
    leagueNoShows(league.id, id),
    organizerAbsences(id),
  ]);
  if (!match || !decision) throw data(NOT_FOUND, { status: 404 });
  return { league: { slug: league.slug, name: league.name }, match, decision, noShow: noShows[0] ?? null, absent };
}

type ActionResult = { intent: string; ok: boolean; message: string };
const NO_SHOW_INTENTS = { "no-show-confirm": "confirm", "no-show-reject": "reject" } as const;

export async function action({ request, params }: Route.ActionArgs) {
  const { league, actor, id } = await scope(request, params);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (intent === "no-show-confirm" || intent === "no-show-reject") {
    const report = Number(form.get("report"));
    const [waiting] = await leagueNoShows(league.id, id);
    if (!waiting || waiting.id !== report)
      return data<ActionResult>({ intent: "no-show", ok: false, message: NO_SHOW_REFUSALS.not_open }, { status: 400 });
    const done = await decideNoShow(actor.id, league.id, report, NO_SHOW_INTENTS[intent], String(form.get("reason") ?? ""));
    if (done.ok) return data<ActionResult>({ intent: "no-show", ok: true, message: done.notice });
    if (done.notFound) throw data(NOT_FOUND, { status: 404 });
    return data<ActionResult>({ intent: "no-show", ok: false, message: done.error }, { status: 400 });
  }
  const outcome = parseOutcome(form);
  if (!outcome) return data<ActionResult>({ intent: "decide", ok: false, message: "Válassz, mi legyen a meccs kimenetele." }, { status: 400 });
  const done = await decideMatch(actor.id, league.id, id, outcome, String(form.get("reason") ?? ""));
  if (done.ok) return data<ActionResult>({ intent: "decide", ok: true, message: done.notice });
  if (!done.ok && done.notFound) throw data(NOT_FOUND, { status: 404 });
  return data<ActionResult>({ intent: "decide", ok: false, message: done.error }, { status: 400 });
}

function resolveBack(slug: string, search: URLSearchParams): { to: string; label: string } {
  const back = search.get("back");
  if (back && back.startsWith(`/admin/leagues/${slug}/`) && !back.startsWith("//")) {
    return { to: back, label: "Vissza" };
  }
  const from = search.get("from");
  if (from === "decisions") return { to: `/admin/leagues/${slug}/disputes`, label: "Döntések" };
  if (from === "overview") return { to: `/admin/leagues/${slug}`, label: "Áttekintés" };
  return { to: `/admin/leagues/${slug}/matches`, label: "Meccsek" };
}

export default function LeagueMatch({ loaderData, actionData }: Route.ComponentProps) {
  const { league, match: m, decision: d, noShow, absent } = loaderData;
  const [search] = useSearchParams();
  const busy = useNavigation().state !== "idle";
  const back = resolveBack(league.slug, search);

  const r = d.result;
  const isDisputed = r.status === "disputed";
  const hasWaitingDecision = isDisputed || !!noShow;
  const choices: { value: OutcomeChoice; label: string }[] = [
    { value: "played", label: "Eredmény (lent add meg)" },
    { value: "walkover-a", label: `Játék nélküli győzelem: ${d.a} (${walkoverScoreText(d.setGames)})` },
    { value: "walkover-b", label: `Játék nélküli győzelem: ${d.b} (${walkoverScoreText(d.setGames)})` },
    { value: "both-inactive", label: bothLostText(d.setGames) },
    { value: "unplayed", label: "Elmaradt (egyik pár sem kap pontot, nem számít bele a tabellába)" },
  ];
  const current: OutcomeChoice | undefined = !d.current
    ? undefined
    : d.current.kind === "walkover"
      ? (`walkover-${d.current.winner}` as const)
      : d.current.kind;
  const score = d.current?.kind === "played" ? d.current.score : null;

  const decisionForm = (primary: boolean) => (
    <Form method="post" className="grid gap-4">
      <RadioGroup name="outcome" defaultValue={current ?? "played"} className="grid gap-2">
        {choices.map((c) => (
          <div key={c.value} className="flex items-start gap-2.5">
            <RadioGroupItem value={c.value} id={`outcome-${c.value}`} className="mt-1" />
            <Label htmlFor={`outcome-${c.value}`} className="leading-snug font-normal">
              {c.label}
            </Label>
          </div>
        ))}
      </RadioGroup>
      <ScoreFields setGames={d.setGames} initial={score} pairA={d.a} pairB={d.b} />
      <div className="grid gap-1.5">
        <Label htmlFor="decision-reason">Indoklás (kötelező, mindkét pár látja)</Label>
        <Textarea id="decision-reason" name="reason" required maxLength={REASON_MAX} rows={3} placeholder="Rövid indoklás a döntéshez..." />
      </div>
      {actionData?.intent === "decide" && <FormFeedback ok={actionData.ok} message={actionData.message} />}
      <div>
        <Button type="submit" size="xl" variant={primary ? "default" : "secondary"} disabled={busy}>
          {primary ? "Döntök" : "Felülbírálom"}
        </Button>
      </div>
    </Form>
  );

  return (
    <Page>
      <PageHeader
        eyebrow={`${m.season} · ${m.phase}. kör · ${weekRange(m.phaseStartsAt, m.week)}`}
        title={`${groupLine(m.groupNumber, m.groupCount)}, ${m.week}. hét`}
        back={back}
      />

      <section className="grid gap-2 rounded-2xl bg-surface p-4 sm:p-5" aria-label="Állapot">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill label={m.label} tone={m.tone} />
          {m.stuck && <Badge variant="destructive">{STUCK_TEXT[m.stuck]}</Badge>}
          <span className="text-caption text-muted-foreground">Határidő: {formatDeadline(m.deadline)}</span>
        </div>
        <p className="text-sm">{m.activity}</p>
        <div className="grid gap-1 text-sm">
          <OrganizerAbsences absent={absent} />
        </div>
      </section>

      {noShow && (
        <section className="grid gap-3 rounded-2xl border border-warning/40 bg-surface p-4 sm:p-5" aria-label="Nem jöttek el bejelentés">
          <SectionLabel tone="warning">Döntésre vár: nem jöttek el</SectionLabel>
          <p className="text-sm">
            <PairNames players={noShow.reportingPlayers} /> szerint <PairNames players={noShow.absentPlayers} /> nem jött el
            {noShow.slot ? ` (${formatSlot(noShow.slot)})` : ""}. Bejelentve: {formatDateTime(noShow.reportedAt)}.
          </p>
          <Form method="post" className="grid gap-3">
            <input type="hidden" name="report" value={noShow.id} />
            <div className="grid gap-1.5">
              <Label htmlFor="ns-reason">Indoklás (opcionális, mindkét pár látja)</Label>
              <Textarea id="ns-reason" name="reason" maxLength={NO_SHOW_REASON_MAX} rows={2} />
            </div>
            {actionData?.intent === "no-show" && <FormFeedback ok={actionData.ok} message={actionData.message} />}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="xl" name="intent" value="no-show-confirm" disabled={busy}>
                Jóváhagyom (játék nélkül)
              </Button>
              <Button type="submit" size="xl" variant="secondary" name="intent" value="no-show-reject" disabled={busy}>
                Elutasítom
              </Button>
            </div>
          </Form>
        </section>
      )}

      {isDisputed && (
        <section className="grid gap-3 rounded-2xl border border-danger/40 bg-surface p-4 sm:p-5" aria-label="Vitatott eredmény döntés">
          <SectionLabel tone="warning">Döntésre vár: vitatott eredmény</SectionLabel>
          <div className="grid gap-1 rounded-xl bg-surface-2 p-3 text-sm">
            <p>
              <PairNames players={d.players[r.by]} /> szerint: <strong>{neutralScoreText(r.score)}</strong>
            </p>
            <p>
              <PairNames players={d.players[r.by === "a" ? "b" : "a"]} /> szerint:{" "}
              <strong>{r.counter ? neutralScoreText(r.counter) : "nem adott meg eredményt"}</strong>
            </p>
            <p className="text-xs text-muted-foreground">
              Az eredmények az 1. pár (<PairNames players={d.players.a} />) szemszögéből.
            </p>
          </div>
          {decisionForm(!noShow)}
        </section>
      )}

      <section className="grid gap-3 sm:grid-cols-2" aria-label="Párok">
        {m.pairs.map((p) => (
          <div key={p.side} className="grid content-start gap-2 rounded-2xl bg-surface p-4">
            <p className="font-semibold break-words">
              {p.players.map((x, i) => (
                <span key={x.id}>
                  {i > 0 && " – "}
                  <PersonLink id={x.id} name={x.name} />
                </span>
              ))}
            </p>
            <div>
              <Badge variant={p.active ? "secondary" : "outline"}>{p.active ? "Lépett" : "Még nem lépett"}</Badge>
            </div>
            {m.running && <Contacts contacts={p.players.map((x) => ({ name: x.name, phone: x.phone ?? "" }))} />}
          </div>
        ))}
        {!m.running && <p className="text-sm text-muted-foreground sm:col-span-2">A kör lezárult, a telefonszámok már nem látszanak.</p>}
      </section>

      <section className="grid gap-2" aria-labelledby="naplo">
        <SectionLabel>Napló</SectionLabel>
        {m.log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Még nem történt semmi.</p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {m.log.map((e) => (
              <li key={e.id} className="grid gap-0.5 rounded-xl bg-surface p-3">
                <span className="text-xs break-words text-muted-foreground">
                  {formatDateTime(e.at)} · <PersonLink id={e.whoId} name={e.who} /> ({e.pair})
                </span>
                <span className="break-words">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {!hasWaitingDecision && (
        <div className="pt-2">
          <OverflowRow label="Felülbírálom">
            <div className="rounded-2xl bg-surface p-4 sm:p-5">
              <p className="mb-3 text-sm text-muted-foreground">
                Bármelyik meccs kimenetelét felülbírálhatod. Az indoklást mindkét pár látja, és a naplóba is bekerül.
              </p>
              {decisionForm(false)}
            </div>
          </OverflowRow>
        </div>
      )}
    </Page>
  );
}

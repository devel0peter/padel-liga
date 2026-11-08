import { proposalErrors } from "@padel-liga/rules";
import { CalendarPlus, ChevronRight, Clock, Download, MapPin, Users } from "lucide-react";
import { useState } from "react";
import { data, Form, useNavigation, useSubmit } from "react-router";

import type { Route } from "./+types/match";
import { AppPage } from "~/components/app-page";
import { GroupMessage } from "~/components/group-message";
import { Contacts, StatusPill } from "~/components/my-group";
import { DayHourPicker, RangePicker, StartPicker } from "~/components/slot-picker";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "~/components/ui/alert-dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requireUser } from "~/lib/auth/session.server";
import type { CalendarLinks } from "~/lib/calendar";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { ConfirmResult, RecordResult, ResultStatus, ScoreBoard } from "~/components/match-result";
import { COURT_MAX, SCHEDULING_GUIDE, fixesAtText, formatSlot, groupLine, statusView } from "~/lib/matches";
import { cn } from "~/lib/utils";
import { loadMatch, matchPage, matchStep, NOT_FOUND, type StepInput } from "~/lib/matches.server";
import { formatRange, parseRangeField, parseStartField, slotErrorText } from "~/lib/slot-ranges";
import { parseScore, resultStatusView } from "~/lib/results";
import { resultStep, type ResultInput } from "~/lib/results.server";
import { SITE_NAME } from "~/lib/site";
import { substituteLine, substitutesEnabled } from "~/lib/substitutes";
import { requestSubstitute, substitutePanel, withdrawSubstitute, type SubstitutePanel } from "~/lib/substitutes.server";
import { noShowPanel, reportNoShow, withdrawNoShow, type NoShowPanel } from "~/lib/no-shows.server";

// A match (#25, #26, D133): a summary (state, when, where, score, phones,
// calendar), the one main step of the state, every other step folded, and
// the log. Only the two pairs' players see it; anyone else gets 404.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Meccs – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

function matchId(params: { id: string }): number {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) throw new Response(NOT_FOUND, { status: 404 });
  return id;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const now = new Date();
  const ctx = await loadMatch(matchId(params));
  const page = ctx && (await matchPage(ctx.match.id, user.id, now, ctx));
  if (!ctx || !page) throw new Response(NOT_FOUND, { status: 404 });
  // Substitutes (#37) and no-shows (#33): only for the four players, like the
  // rest of the page. No substitutes in the first season (D145).
  const [substitutes, noShow] = await Promise.all([
    substitutesEnabled() ? substitutePanel(ctx, page.side, user.id, now) : null,
    noShowPanel(ctx, page.side, user.id, now),
  ]);
  // A fixed time that has started: recording the result becomes the main step (D133).
  const started = page.state.status === "scheduled" && page.state.slot.getTime() <= now.getTime();
  // `now`: the time pickers draw their days and hours from the server's clock.
  // `url`: this page, absolute, for the Írj mindenkinek text (D147).
  return { ...page, substitutes, noShow, started, now, url: `${new URL(request.url).origin}/matches/${page.id}` };
}

const NONE = "none";
// More ranges than anyone needs: the rest of a bigger form is ignored.
const MAX_RANGES = 40;

type ActionResult = {
  intent: string;
  ok: boolean;
  message: string;
};

function clubId(form: FormData): number | null | undefined {
  const v = String(form.get("club") ?? NONE);
  if (v === NONE || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const id = matchId(params);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const fail = (message: string) => data<ActionResult>({ intent, ok: false, message }, { status: 400 });

  // The result (#28): the form's games from this player's side; the server
  // turns them into the match's order with the player's side.
  if (intent === "result-record" || intent === "result-confirm" || intent === "result-dispute") {
    const page = await matchPage(id, user.id);
    if (!page) throw new Response(NOT_FOUND, { status: 404 });
    const input: ResultInput =
      intent === "result-confirm"
        ? { kind: "confirm" }
        : intent === "result-record"
          ? // Where it was played: read only while no club is known (D146).
            { kind: "record", score: parseScore(form, page.side), clubId: clubId(form) ?? null, court: String(form.get("court") ?? "") }
          : {
              kind: "dispute",
              score: parseScore(form, page.side),
              note: String(form.get("note") ?? ""),
            };
    const done = await resultStep(user.id, id, input);
    if (done.ok) return data<ActionResult>({ intent, ok: true, message: done.notice });
    if (done.error === NOT_FOUND) throw new Response(NOT_FOUND, { status: 404 });
    return fail(done.error);
  }

  // A substitute for an absent player of the pair (#37, D109); while hidden
  // (D145) both steps refuse.
  if (intent === "substitute-request" || intent === "substitute-withdraw") {
    const done =
      intent === "substitute-request"
        ? await requestSubstitute(user.id, id, {
            absentId: String(form.get("absent") ?? ""),
            substituteId: String(form.get("substitute") ?? ""),
          })
        : await withdrawSubstitute(user.id, id, Number(form.get("request")));
    if (done.ok) return data<ActionResult>({ intent, ok: true, message: done.notice });
    if (done.notFound) throw new Response(NOT_FOUND, { status: 404 });
    return fail(done.error);
  }

  // The other pair didn't show up at the agreed slot (#33, D108).
  if (intent === "no-show-report" || intent === "no-show-withdraw") {
    const done = intent === "no-show-report" ? await reportNoShow(user.id, id) : await withdrawNoShow(user.id, id, Number(form.get("report")));
    if (done.ok) return data<ActionResult>({ intent, ok: true, message: done.notice });
    if (done.notFound) throw new Response(NOT_FOUND, { status: 404 });
    return fail(done.error);
  }

  let input: StepInput;
  if (intent === "propose") {
    // The ranges as "2026-11-14|14|18" (D144), Budapest days and hours.
    const ranges = form.getAll("range").map(String).slice(0, MAX_RANGES).map(parseRangeField);
    const club = clubId(form);
    if (club === undefined) return fail("Válassz a listából helyszínt, vagy hagyd üresen.");
    input = { kind: "propose", ranges, clubId: club };
  } else if (intent === "agreed") {
    // "2026-11-14|18": a Budapest day and a whole hour.
    const club = clubId(form);
    if (club === undefined) return fail("Válassz a listából helyszínt, vagy hagyd üresen.");
    input = { kind: "agreed", slot: parseStartField(String(form.get("slot") ?? "")), clubId: club };
  } else if (intent === "accept") {
    const at = Number(form.get("slot"));
    if (!Number.isFinite(at)) return fail("Válassz egy időpontot.");
    input = { kind: "accept", slot: new Date(at) };
  } else if (intent === "confirm" || intent === "decline" || intent === "cancel") {
    input = { kind: intent };
  } else if (intent === "venue") {
    const club = clubId(form);
    if (club === undefined) return fail("Válassz helyszínt a listából.");
    input = {
      kind: "venue",
      clubId: club,
      court: String(form.get("court") ?? ""),
    };
  } else throw new Response("Hibás kérés.", { status: 400 });

  const result = await matchStep(user.id, id, input);
  if (result.ok) return data<ActionResult>({ intent, ok: true, message: result.notice });
  if (result.error === NOT_FOUND) throw new Response(NOT_FOUND, { status: 404 });
  return fail(result.error);
}

// A step's answer. Forms show only their errors; the summary shows every
// confirmation (`ok`), since the form that sent it may be folded or gone.
function Feedback({ result, intent, ok = false }: { result: ActionResult | undefined; intent: string | string[]; ok?: boolean }) {
  if (!result || !(Array.isArray(intent) ? intent : [intent]).includes(result.intent)) return null;
  if (result.ok && !ok) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={result.ok ? "font-medium" : "font-semibold text-destructive"}>
      {result.message}
    </p>
  );
}

// The page's two kinds of block (D133, docs/player-ui.md M2): the one main
// step of the state, open, and every other step folded behind a one-line
// opener, so nothing is lost but only one thing asks for attention.
function Panel({ title, description, children, tone }: { title: string; description?: React.ReactNode; children: React.ReactNode; tone?: "main" }) {
  return (
    <section
      aria-label={title}
      className={cn("grid max-w-2xl gap-3 rounded-xl border bg-card p-4 sm:p-5", tone === "main" && "border-nav-active ring-1 ring-nav-active/30")}
    >
      <div className="grid gap-1">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        {description && <div className="text-sm text-muted-foreground">{description}</div>}
      </div>
      {children}
    </section>
  );
}

function Fold({
  title,
  hint,
  open,
  heading,
  children,
}: {
  title: string;
  hint?: string;
  open?: boolean;
  // The title as a heading (h2), for the guide that is read more than used.
  heading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details className="group max-w-2xl rounded-xl border bg-card" open={open || undefined} aria-label={title}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 py-2 [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <span className="grid">
          {heading ? <h2 className="font-semibold">{title}</h2> : <span className="font-semibold">{title}</span>}
          {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
        </span>
      </summary>
      <div className="grid gap-3 border-t px-4 py-4">{children}</div>
    </details>
  );
}

function ClubSelect({ clubs, id }: { clubs: { id: number; name: string }[]; id: string }) {
  if (clubs.length === 0) return null;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>Helyszín (nem kötelező)</Label>
      <Select name="club" defaultValue={NONE}>
        <SelectTrigger id={id} className="w-full sm:w-72">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>Még nincs megadva</SelectItem>
          {clubs.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const PROPOSE_RULES = "Írjátok meg, mikor értek rá, legalább 2 különböző napon. A másik pár ebből választ egy időpontot.";

// A step's own error before sending (D144): the rules engine's messages, the
// same the server would answer with.
function ClientError({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="font-semibold text-destructive">
      {message}
    </p>
  ) : null;
}

function ProposeForm({ clubs, result, now, deadline }: { clubs: { id: number; name: string }[]; result?: ActionResult; now: Date; deadline: Date }) {
  const busy = useNavigation().state !== "idle";
  const [error, setError] = useState<string | null>(null);
  return (
    <Form
      method="post"
      className="grid gap-4"
      onSubmit={(e) => {
        const ranges = new FormData(e.currentTarget).getAll("range").map(String).map(parseRangeField);
        const errors = proposalErrors(ranges, new Date(), deadline);
        setError(errors.length > 0 ? slotErrorText(errors) : null);
        if (errors.length > 0) e.preventDefault();
      }}
    >
      <input type="hidden" name="intent" value="propose" />
      <RangePicker now={now} deadline={deadline} />
      <ClubSelect clubs={clubs} id="propose-club" />
      <ClientError message={error} />
      {!error && <Feedback result={result} intent="propose" />}
      <div>
        <Button type="submit" disabled={busy}>
          Elküldöm, mikor érünk rá
        </Button>
      </div>
    </Form>
  );
}

// D148: one step. The other pair may object for 24 hours (or until the
// start, if sooner); otherwise the time is fixed by itself.
const AGREED_HELP = "A másik pár 24 órán belül (vagy a kezdésig, ha az hamarabb van) jelezheti, ha nem így beszéltétek. Ha nem jelez, az időpont fix.";
const AGREED_TITLE = "Megbeszéltétek? Rögzítsétek az időpontot";
const PROPOSE_TITLE = "Vagy adjátok meg, mikor értek rá, és a másik pár választ";
const TALK_LINE = "Beszéljétek meg SMS-ben vagy e-mailben, aztán rögzítsétek itt az időpontot.";

function AgreedForm({
  clubs,
  result,
  now,
  deadline,
  primary = false,
}: {
  clubs: { id: number; name: string }[];
  result?: ActionResult;
  now: Date;
  deadline: Date;
  primary?: boolean;
}) {
  const busy = useNavigation().state !== "idle";
  const [error, setError] = useState<string | null>(null);
  return (
    <Form
      method="post"
      className="grid gap-3"
      onSubmit={(e) => {
        const missing = !new FormData(e.currentTarget).get("slot");
        setError(missing ? "Válassz napot és órát." : null);
        if (missing) e.preventDefault();
      }}
    >
      <p className="text-sm text-muted-foreground">{AGREED_HELP}</p>
      <input type="hidden" name="intent" value="agreed" />
      <DayHourPicker now={now} deadline={deadline} />
      <ClubSelect clubs={clubs} id="agreed-club" />
      <ClientError message={error} />
      {!error && <Feedback result={result} intent="agreed" />}
      <div>
        <Button type="submit" variant={primary ? "default" : "outline"} disabled={busy}>
          Rögzítem az időpontot
        </Button>
      </div>
    </Form>
  );
}

// The club (required) and the court (optional free text): the city's active
// clubs only. The venue form's fields (#27); the result form, while the match
// has no club, asks only for the club (D146: the court doesn't matter there).
function VenueFields({
  clubs,
  id,
  label,
  clubId = null,
  court = null,
  withCourt = true,
}: {
  clubs: { id: number; name: string }[];
  id: string;
  label: string;
  clubId?: number | null;
  court?: string | null;
  withCourt?: boolean;
}) {
  const current = clubs.some((c) => c.id === clubId) ? String(clubId) : undefined;
  return (
    <div className={cn("grid gap-3", withCourt && "sm:grid-cols-2")}>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-club`}>{label}</Label>
        <Select name="club" defaultValue={current} required>
          <SelectTrigger id={`${id}-club`} className="w-full">
            <SelectValue placeholder="Válassz klubot" />
          </SelectTrigger>
          <SelectContent>
            {clubs.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {withCourt && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-court`}>Pálya (nem kötelező)</Label>
          <Input id={`${id}-court`} name="court" defaultValue={court ?? ""} maxLength={COURT_MAX} placeholder="pl. 2-es pálya" className="w-full" />
        </div>
      )}
    </div>
  );
}

// Whoever booked the court records where (#27); both pairs see it.
function VenueForm({
  clubs,
  clubId,
  court,
  result,
}: {
  clubs: { id: number; name: string }[];
  clubId: number | null;
  court: string | null;
  result?: ActionResult;
}) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form method="post" className="grid gap-3">
      <input type="hidden" name="intent" value="venue" />
      <VenueFields clubs={clubs} id="venue" label="Helyszín" clubId={clubId} court={court} />
      <Feedback result={result} intent="venue" />
      <div>
        <Button type="submit" variant="outline" disabled={busy}>
          Mentem a helyszínt
        </Button>
      </div>
    </Form>
  );
}

// Either pair cancels the scheduled slot until it starts (#27, spec 6.6).
// Under 24 hours before it the cancellation is late, and the page says what
// that means before asking.
function cancelConsequence(late: boolean): string {
  return late
    ? "Már 24 órán belül van a kezdés, ez késői lemondás: utána nektek kell új időpontot ajánlani, és ha a határidőig nem játsszátok le a meccset, az ellenfeleitek nyernek 4:0, 4:0-ra."
    : "Utána újra egyeztettek. Ha a kezdés előtti 24 órában mondjátok le, az késői lemondás: akkor nektek kell új időpontot ajánlani.";
}

function CancelButton({ late }: { late: boolean }) {
  const busy = useNavigation().state !== "idle";
  const submit = useSubmit();
  return (
    <>
      <p className="text-sm text-muted-foreground">{cancelConsequence(late)}</p>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="outline" className="w-fit" disabled={busy}>
            Lemondom a meccset
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{late ? "Késői lemondás. Biztosan lemondod?" : "Lemondod a meccset?"}</AlertDialogTitle>
            <AlertDialogDescription>{cancelConsequence(late)} A másik pár értesítést kap.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Mégse</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => submit({ intent: "cancel" }, { method: "post" })}>
              Lemondom
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Helyettes (#37, spec 4, D109): either player of the pair asks for a
// substitute for an absent player until the match starts; the organizer
// approves. Approved substitutes show to all four players; the pair's own
// requests (with the organizer's reason) only to the pair.
function SubstituteBody({ s, deadline, result }: { s: SubstitutePanel; deadline: Date; result?: ActionResult }) {
  const busy = useNavigation().state !== "idle";
  return (
    <>
      {s.approved.length > 0 && (
        <ul className="grid gap-1 text-sm" aria-label="Jóváhagyott helyettesek">
          {s.approved.map((a) => (
            <li key={a.id}>
              <span className="font-medium">{substituteLine(a)}</span> játszik {a.ours ? "nálatok" : "az ellenfeleiteknél"}.
            </li>
          ))}
        </ul>
      )}
      {s.ours.length > 0 && (
        <ul className="grid gap-2 text-sm" aria-label="Kéréseitek">
          {s.ours.map((r) => (
            <li key={r.id} className="grid gap-1 rounded-md border p-3">
              <span className="break-words">
                {substituteLine(r)}: <span className="font-medium">{r.label}</span>
              </span>
              {r.reason && <span className="break-words text-muted-foreground">A szervező indoklása: {r.reason}</span>}
              {r.canWithdraw && (
                <Form method="post">
                  <input type="hidden" name="intent" value="substitute-withdraw" />
                  <input type="hidden" name="request" value={r.id} />
                  <Button type="submit" variant="outline" size="sm" disabled={busy}>
                    Visszavonom a kérést
                  </Button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
      {s.form && (
        <Form method="post" className="grid gap-3">
          <p className="text-sm text-muted-foreground">
            Ha valamelyikőtök nem tud játszani, kérjetek helyettest {s.closesAt.getTime() === deadline.getTime() ? "a határidőig" : "a meccs kezdetéig"}. A
            szervező hagyja jóvá. A helyettes legyen nagyjából azonos vagy gyengébb szintű, és nem játszhat másik párban a csoportban.
          </p>
          <input type="hidden" name="intent" value="substitute-request" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="substitute-absent">Ki nem tud játszani?</Label>
              <Select name="absent" defaultValue={s.form.absent.length === 1 ? s.form.absent[0]!.id : undefined} required>
                <SelectTrigger id="substitute-absent" className="w-full">
                  <SelectValue placeholder="Válassz" />
                </SelectTrigger>
                <SelectContent>
                  {s.form.absent.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="substitute-player">Ki helyettesít?</Label>
              {s.form.candidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">Most nincs olyan regisztrált játékos, aki helyettesíthetne.</p>
              ) : (
                <Select name="substitute" required>
                  <SelectTrigger id="substitute-player" className="w-full">
                    <SelectValue placeholder="Válassz játékost" />
                  </SelectTrigger>
                  <SelectContent>
                    {s.form.candidates.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Csak regisztrált játékost választhatsz. Ha nincs a listán, előbb regisztráljon.</p>
          <Feedback result={result} intent="substitute-request" />
          <div>
            <Button type="submit" variant="outline" disabled={busy || s.form.candidates.length === 0}>
              Helyettest kérek
            </Button>
          </div>
        </Form>
      )}
      <Feedback result={result} intent="substitute-withdraw" />
    </>
  );
}

// Nem jöttek el (#33, spec 8, D108): after the agreed slot's start a player
// of the pair that showed up reports it; the organizer confirms (4-0 4-0 and
// a strike for the other pair) or rejects it. Both pairs see a waiting
// report and the decision with its reason; only the reporter can withdraw.
function NoShowBody({ s, result }: { s: NoShowPanel; result?: ActionResult }) {
  const busy = useNavigation().state !== "idle";
  const submit = useSubmit();
  return (
    <>
      {s.canReport && (
        <p className="text-sm text-muted-foreground">
          Ha a lefixált időpontban nem jelentek meg, jelezd. A szervező dönt: ha jóváhagyja, 4:0, 4:0-ra nyertek, és ők fekete pontot kapnak.
        </p>
      )}
      {s.open && (
        <div className="grid gap-2 text-sm" role="status">
          <p className="break-words">
            {s.open.ours
              ? `Jeleztétek, hogy az ellenfeletek nem jött el (${formatDateTime(s.open.at)}). A szervező dönt róla.`
              : `Az ellenfeletek jelezte, hogy nem jöttetek el (${formatDateTime(s.open.at)}). A szervező dönt róla; ha nem így volt, szólj neki.`}
          </p>
          {s.open.canWithdraw && (
            <Form method="post">
              <input type="hidden" name="intent" value="no-show-withdraw" />
              <input type="hidden" name="report" value={s.open.id} />
              <Button type="submit" variant="outline" size="sm" disabled={busy}>
                Visszavonom a bejelentést
              </Button>
            </Form>
          )}
        </div>
      )}
      {s.decided.length > 0 && (
        <ul className="grid gap-2 text-sm" aria-label="A szervező döntései">
          {s.decided.map((d) => (
            <li key={d.id} className="grid gap-1 rounded-md border p-3">
              <span className="break-words">
                {d.confirmed
                  ? d.ours
                    ? "A szervező jóváhagyta a bejelentéseteket: 4:0, 4:0 nektek."
                    : "A szervező jóváhagyta, hogy nem jöttetek el: 0:4, 0:4, és fekete pontot kaptatok."
                  : d.ours
                    ? "A szervező elutasította a bejelentéseteket."
                    : "A szervező elutasította az ellenfeleitek bejelentését."}{" "}
                <span className="text-muted-foreground">({formatDateTime(d.at)})</span>
              </span>
              {d.reason && <span className="break-words text-muted-foreground">A szervező indoklása: {d.reason}</span>}
            </li>
          ))}
        </ul>
      )}
      {s.canReport && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-fit" disabled={busy}>
              Nem jöttek el
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Biztosan nem jöttek el?</AlertDialogTitle>
              <AlertDialogDescription>
                A szervező értesítést kap, és ő dönt. Ha jóváhagyja, 4:0, 4:0-ra nyertek, az ellenfeleitek fekete pontot kapnak. Amíg nem döntött, visszavonhatod.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Mégse</AlertDialogCancel>
              <AlertDialogAction onClick={() => submit({ intent: "no-show-report" }, { method: "post" })}>Jelzem</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      <Feedback result={result} intent={["no-show-report", "no-show-withdraw"]} />
    </>
  );
}

// Add the fixed time to the calendar (#192, D106): a Google Calendar link and
// an .ics file. The file keeps one entry per match: a new download replaces
// the old one, and after a cancellation it removes it. An entry added with the
// Google link has Google's own id, so that one is changed by hand.
function CalendarRow({ calendar }: { calendar: CalendarLinks }) {
  return (
    <div className="grid gap-1.5" role="group" aria-label="Naptárba">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{calendar.cancelled ? "Naptár" : "Naptárba"}:</span>
        {calendar.googleUrl && (
          <Button variant="outline" size="sm" asChild>
            <a href={calendar.googleUrl} target="_blank" rel="noreferrer">
              <CalendarPlus /> Google Naptár
            </a>
          </Button>
        )}
        <Button variant="outline" size="sm" asChild>
          <a href={calendar.icsUrl} download>
            <Download /> .ics letöltése
          </a>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {calendar.cancelled
          ? "Lemondták az időpontot. Töltsd le újra az .ics-t, és a naptáradból is kikerül. Ha a Google Naptár gombbal tetted be, ott töröld kézzel."
          : "Ha változik az időpont, az új .ics lecseréli a régit. Ha a Google Naptár gombbal tetted be, ott írd át kézzel."}
      </p>
    </div>
  );
}

// When and where, as the summary shows it (docs/player-ui.md M1).
function whenLine(m: Route.ComponentProps["loaderData"]): string {
  switch (m.state.status) {
    case "scheduled":
      return formatSlot(m.state.slot);
    case "agreed_time":
      return `${formatSlot(m.state.slot)} (még nem fix)`;
    case "proposed":
      return "Válasszatok az ajánlott időpontokból";
    case "to_schedule":
      return m.result.status === "none" ? "Még nincs időpont" : "Nincs rögzített időpont";
  }
}

function Fact({ icon: Icon, label, children }: { icon: React.ComponentType<{ className?: string }>; label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <Icon className="mt-0.5 size-4 shrink-0 text-court" />
      <div className="grid min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-medium break-words">{children}</span>
      </div>
    </div>
  );
}

export default function MatchRoute({ loaderData: m, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const result = actionData as ActionResult | undefined;
  const status = resultStatusView(m.result, m.side) ?? statusView(m.state, m.side, m.venue);
  const r = m.result;
  const theirs = m.state.status !== "to_schedule" && m.state.status !== "scheduled" && m.state.by !== m.side;
  const ours = (m.state.status === "proposed" || m.state.status === "agreed_time") && !theirs;
  const failed = (intent: string) => result?.intent === intent && !result.ok;
  const keyed = m.log.length;

  // The one main step (D133). Everything else is folded below it.
  const confirmResult = r.status === "recorded" && m.resultActions.confirm;
  const recordMain = r.status === "none" && m.resultActions.record && m.started;
  const recordFolded = m.resultActions.record && !recordMain && !confirmResult;
  const venueMain = m.state.status === "scheduled" && m.actions.venue && !m.started && m.state.clubId === null && m.clubs.length > 0;
  // No fixed time yet and nothing of theirs to answer (D148): first talk by
  // SMS or e-mail, then record the time (open), the ranges folded below.
  // With our own agreed time waiting, recording another one stays folded.
  const talk = m.actions.propose && !!m.message && m.message.to.length > 0;
  const agreedOpen = m.actions.recordAgreed && !theirs && m.state.status !== "agreed_time";
  const subs = m.substitutes;
  const substitutesShown = !!subs && (subs.approved.length > 0 || subs.ours.length > 0);
  const noShowShown = !!m.noShow.open || m.noShow.decided.length > 0;

  return (
    <AppPage
      title={`${m.opponents} ellen`}
      description={`${groupLine(m.groupNumber, m.groupCount)} · ${m.week}. hét (${weekRange(m.phaseStartsAt, m.week)}) · határidő: ${formatDeadline(m.deadline)}`}
      back={{ to: "/home", label: "Kezdőlap" }}
    >
      <div className="grid gap-6 xl:grid-cols-[minmax(0,42rem)_minmax(0,1fr)] xl:items-start">
        <div className="grid min-w-0 content-start gap-6">
          <section className="grid max-w-2xl gap-4 rounded-xl border bg-card p-4 sm:p-5" aria-label="Állapot">
            {m.voided ? (
              <p role="status" className="font-semibold">
                {m.voided}
              </p>
            ) : (
              <div>
                <StatusPill {...status} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <Fact icon={Clock} label="Időpont">
                {whenLine(m)}
              </Fact>
              <Fact icon={MapPin} label="Helyszín">
                {m.where ?? "Még nincs megadva"}
              </Fact>
            </div>
            <p className="flex items-center gap-2 text-sm">
              <Users className="size-4 shrink-0 text-court" />
              <span>
                <span className="text-muted-foreground">Ti:</span> {m.us}
              </span>
            </p>
            {r.status === "final" && r.outcome.kind === "played" && <ScoreBoard score={r.outcome.score} side={m.side} us={m.us} them={m.opponents} />}
            {r.status === "recorded" && !confirmResult && (
              <ScoreBoard score={r.score} side={m.side} us={m.us} them={m.opponents} />
            )}
            {m.contacts.length > 0 && r.status !== "final" && (
              <div className="grid gap-1.5">
                <p className="text-sm font-medium">Az ellenfeleitek elérhetősége:</p>
                <Contacts contacts={m.contacts} />
                {/* While scheduling, Írjatok egymásnak below has it. */}
                {!talk && <GroupMessage message={m.message} week={m.week} url={m.url} matchId={m.id} />}
              </div>
            )}
            {m.calendar && <CalendarRow calendar={m.calendar} />}
            {/* Every step's confirmation shows here: the form that sent it may be folded or gone now. */}
        {result?.ok ? <Feedback result={result} intent={result.intent} ok /> : <Feedback result={result} intent={["accept", "confirm", "decline", "cancel"]} />}
          </section>

          {/* --- The main step ------------------------------------------------ */}

          {confirmResult && (
            <section
              id="eredmeny"
              aria-label="Eredmény"
              className="grid max-w-2xl scroll-mt-20 gap-3 rounded-xl border border-nav-active bg-card p-4 ring-1 ring-nav-active/30 sm:p-5"
            >
              <h2 className="sr-only">Eredmény</h2>
              <ConfirmResult key={`r${keyed}`} m={m} feedback={result} />
            </section>
          )}

          {/* A confirmed played result is already on the score board above. */}
          {r.status !== "none" && !confirmResult && !(r.status === "final" && r.outcome.kind === "played" && r.how === "confirmed") && (
            <Panel title="Eredmény">
                            <ResultStatus m={m} />
            </Panel>
          )}

          {recordMain && (
            <Panel title="Eredmény rögzítése" description="Lejátszottátok? Írjátok be, mi lett. A másik pár megerősíti." tone="main">
              <RecordResult key={`r${keyed}`} m={m} feedback={result}>
                {m.venueAsked && <VenueFields clubs={m.clubs} id="record" label="Hol játszottatok?" withCourt={false} />}
              </RecordResult>
            </Panel>
          )}

          {m.state.status === "proposed" && theirs && m.actions.accept.length > 0 && (
            <Panel
              title="Válasszatok időpontot"
              description={`Ekkor érnek rá. Egy meccs 60 perc.${m.venue ? ` Helyszín: ${m.venue}.` : ""}`}
              tone="main"
            >
              <Form method="post" className="grid gap-4">
                <input type="hidden" name="intent" value="accept" />
                <StartPicker ranges={m.actions.accept} />
                <div>
                  <Button type="submit" size="lg" disabled={busy}>
                    Elfogadom
                  </Button>
                </div>
              </Form>
            </Panel>
          )}

          {m.state.status === "agreed_time" && m.actions.confirm && (
            <Panel
              title="Megerősíted az időpontot?"
              description={`Az ellenfeletek szerint így beszéltétek meg: ${formatSlot(m.state.slot)}${m.venue ? `, ${m.venue}` : ""}. Fix lesz ${fixesAtText(m.state.fixesAt)}, ha nem jelzitek, hogy nem így beszéltétek.`}
              tone="main"
            >
              <div className="flex flex-wrap gap-2">
                <Form method="post">
                  <input type="hidden" name="intent" value="confirm" />
                  <Button type="submit" size="lg" disabled={busy}>
                    Megerősítem
                  </Button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="decline" />
                  <Button type="submit" size="lg" variant="outline" disabled={busy}>
                    Nem így beszéltük
                  </Button>
                </Form>
              </div>
            </Panel>
          )}

          {ours && r.status === "none" && (
            <Panel
              title={m.state.status === "proposed" ? "Ekkor értek rá" : "Ezt rögzítettétek"}
              description={
                m.state.status === "proposed"
                  ? "A másik pár ebből választ egy időpontot, vagy mást ajánl."
                  : m.state.status === "agreed_time"
                    ? `Fix lesz ${fixesAtText(m.state.fixesAt)}, ha a másik pár nem jelez.`
                    : undefined
              }
            >
              <ul className="flex flex-wrap gap-2 text-sm">
                {m.state.status === "proposed"
                  ? m.state.ranges.map((r) => (
                      <li key={r.start.getTime()} className="rounded-md bg-muted px-2.5 py-1.5 font-medium">
                        {formatRange(r)}
                      </li>
                    ))
                  : m.state.status === "agreed_time" && <li className="rounded-md bg-muted px-2.5 py-1.5 font-medium">{formatSlot(m.state.slot)}</li>}
              </ul>
            </Panel>
          )}

          {talk && (
            <Panel title="Írjatok egymásnak" description={TALK_LINE} tone={theirs ? undefined : "main"}>
              <GroupMessage message={m.message} week={m.week} url={m.url} matchId={m.id} />
            </Panel>
          )}

          {agreedOpen && (
            <Panel title={AGREED_TITLE} tone={talk ? undefined : "main"}>
              <AgreedForm key={`a${keyed}`} clubs={m.clubs} result={result} now={m.now} deadline={m.deadline} primary />
            </Panel>
          )}

          {venueMain && (
            <Panel title="Hol lesz a meccs?" description="Aki lefoglalta a pályát, írja be, hol. Mindkét pár látja." tone="main">
              <VenueForm key={`v${keyed}`} clubs={m.clubs} clubId={m.state.status === "scheduled" ? m.state.clubId : null} court={null} result={result} />
            </Panel>
          )}

          {(noShowShown || (m.noShow.canReport && m.started)) && (
            <Panel title={m.noShow.canReport ? "Nem jött el az ellenfél?" : "Nem jöttek el"}>
              <NoShowBody s={m.noShow} result={result} />
            </Panel>
          )}

          {subs && substitutesShown && (
            <Panel title="Helyettes">
              <SubstituteBody key={`s${subs.ours.length}`} s={subs} deadline={m.deadline} result={result} />
            </Panel>
          )}

          {/* --- Everything else, folded --------------------------------------- */}

          {m.actions.recordAgreed && !agreedOpen && (
            <Fold title={AGREED_TITLE} hint="A másik pár 24 órán belül jelezheti, ha nem így volt." open={failed("agreed")}>
              <AgreedForm key={`a${keyed}`} clubs={m.clubs} result={result} now={m.now} deadline={m.deadline} />
            </Fold>
          )}

          {m.actions.propose && (
            <Fold
              title={theirs && m.state.status === "proposed" ? "Egyik sem jó? Adjátok meg, mikor értek rá" : PROPOSE_TITLE}
              hint={PROPOSE_RULES}
              open={failed("propose")}
            >
              <ProposeForm key={`p${keyed}`} clubs={m.clubs} result={result} now={m.now} deadline={m.deadline} />
            </Fold>
          )}

          {m.state.status === "scheduled" && m.actions.venue && !venueMain && m.clubs.length > 0 && (
            <Fold title={m.state.clubId ? "Helyszín módosítása" : "Hol lesz a meccs?"} hint="Aki lefoglalta a pályát, írja be, hol." open={failed("venue")}>
              <VenueForm key={`v${keyed}`} clubs={m.clubs} clubId={m.state.clubId} court={m.state.court ?? null} result={result} />
            </Fold>
          )}

          {recordFolded && (
            <Fold
              title={r.status === "recorded" ? "Elírtátok? Javítsátok ki" : "Már lejátszottátok? Írjátok be az eredményt"}
              hint={r.status === "recorded" ? "A 48 óra újraindul." : "Ha a meccs megvolt, itt írjátok be."}
              open={failed("result-record")}
            >
              <RecordResult key={`r${keyed}`} m={m} feedback={result}>
                {m.venueAsked && <VenueFields clubs={m.clubs} id="record" label="Hol játszottatok?" withCourt={false} />}
              </RecordResult>
            </Fold>
          )}

          {m.state.status === "scheduled" && m.actions.cancel && (
            <Fold title="Mégsem jó az időpont?" hint={m.cancelLate ? "Késői lemondás: már 24 órán belül van a kezdés." : "Lemondhatjátok, utána újra egyeztettek."}>
              <CancelButton late={m.cancelLate} />
            </Fold>
          )}

          {m.noShow.canReport && !m.started && !noShowShown && (
            <Fold title="Nem jött el az ellenfél?" open={failed("no-show-report")}>
              <NoShowBody s={m.noShow} result={result} />
            </Fold>
          )}

          {subs?.form && !substitutesShown && (
            <Fold title="Helyettes kell?" hint="Ha valamelyikőtök nem tud játszani." open={failed("substitute-request")}>
              <SubstituteBody key={`s${subs.ours.length}`} s={subs} deadline={m.deadline} result={result} />
            </Fold>
          )}

          {m.actions.propose && (
            <Fold title="Hogyan egyeztessetek?" heading>
              {SCHEDULING_GUIDE.map((s) => (
                <p key={s} className="text-sm">
                  {s}
                </p>
              ))}
            </Fold>
          )}
        </div>
        <section className="grid max-w-2xl gap-2 xl:sticky xl:top-6" aria-labelledby="naplo">
          <h2 id="naplo" className="font-display text-lg font-bold">
            Napló
          </h2>
          {m.log.length === 0 ? (
            <p className="text-sm text-muted-foreground">Még nem történt semmi.</p>
          ) : (
            <ol className="grid gap-0 border-l-2 border-muted pl-4 text-sm">
              {m.log.map((e) => (
                <li key={e.key} className="relative grid gap-0.5 pb-3 last:pb-0">
                  <span
                    aria-hidden
                    className={cn(
                      "absolute top-1.5 -left-[1.4rem] size-2.5 rounded-full border-2 border-background",
                      e.ours ? "bg-nav-active" : "bg-muted-foreground",
                    )}
                  />
                  <span className="text-xs text-muted-foreground">
                    {formatDateTime(e.at)} · {e.who} ({e.by === "organizer" ? "szervező" : e.by === "auto" ? "automatikus" : e.ours ? "ti" : "ellenfél"})
                  </span>
                  <span className="break-words">{e.text}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </AppPage>
  );
}

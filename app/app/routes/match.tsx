import { CalendarPlus, ChevronRight, Clock, Download, MapPin, Plus, Users } from "lucide-react";
import { useState } from "react";
import { data, Form, useNavigation, useSubmit } from "react-router";

import type { Route } from "./+types/match";
import { AppPage } from "~/components/app-page";
import { Contacts, StatusPill } from "~/components/my-group";
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
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requireUser } from "~/lib/auth/session.server";
import type { CalendarLinks } from "~/lib/calendar";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { ConfirmResult, RecordResult, ResultStatus, ScoreBoard } from "~/components/match-result";
import { COURT_MAX, SCHEDULING_GUIDE, formatSlot, groupLine, parseSlot, parseSlots, statusView, venueLine } from "~/lib/matches";
import { cn } from "~/lib/utils";
import { loadMatch, matchPage, matchStep, NOT_FOUND, slotErrorText, type StepInput } from "~/lib/matches.server";
import { parseScore, resultStatusView } from "~/lib/results";
import { resultStep, type ResultInput } from "~/lib/results.server";
import { SITE_NAME } from "~/lib/site";
import { substituteLine } from "~/lib/substitutes";
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
  // Substitutes (#37) and no-shows (#33): only for the four players, like the rest of the page.
  const [substitutes, noShow] = await Promise.all([substitutePanel(ctx, page.side, user.id, now), noShowPanel(ctx, page.side, user.id, now)]);
  // A fixed time that has started: recording the result becomes the main step (D133).
  const started = page.state.status === "scheduled" && page.state.slot.getTime() <= now.getTime();
  return { ...page, substitutes, noShow, started };
}

const NONE = "none";
const MAX_SLOTS = 8;

type ActionResult = {
  intent: string;
  ok: boolean;
  message: string;
  rows?: Record<number, string>;
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
  const fail = (message: string, rows?: Record<number, string>) => data<ActionResult>({ intent, ok: false, message, rows }, { status: 400 });

  // The result (#28): the form's games from this player's side; the server
  // turns them into the match's order with the player's side.
  if (intent === "result-record" || intent === "result-confirm" || intent === "result-dispute") {
    const page = await matchPage(id, user.id);
    if (!page) throw new Response(NOT_FOUND, { status: 404 });
    const input: ResultInput =
      intent === "result-confirm"
        ? { kind: "confirm" }
        : intent === "result-record"
          ? { kind: "record", score: parseScore(form, page.side) }
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

  // A substitute for an absent player of the pair (#37, D109).
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
  // Row numbers of the filled slot fields, so an error lands on its row.
  let filled: number[] = [];
  if (intent === "propose") {
    const raw = form.getAll("slot").map(String).slice(0, MAX_SLOTS);
    filled = raw.flatMap((v, i) => (v.trim() ? [i] : []));
    const club = clubId(form);
    if (club === undefined) return fail("Válassz a listából helyszínt, vagy hagyd üresen.");
    input = { kind: "propose", slots: parseSlots(raw), clubId: club };
  } else if (intent === "agreed") {
    const slot = parseSlot(String(form.get("slot") ?? ""));
    const club = clubId(form);
    if (club === undefined) return fail("Válassz a listából helyszínt, vagy hagyd üresen.");
    input = {
      kind: "agreed",
      slot: slot || new Date(Number.NaN),
      clubId: club,
    };
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
  const rows: Record<number, string> = {};
  for (const e of result.slotErrors ?? [])
    if (e.slot !== undefined) {
      const row = intent === "propose" ? filled[e.slot] : 0;
      if (row !== undefined) rows[row] = [rows[row], slotErrorText([e])].filter(Boolean).join(" ");
    }
  return fail(result.error, rows);
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
    <details className="group max-w-2xl rounded-xl border bg-card" open={open || undefined}>
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

const PROPOSE_RULES = "Legalább 3 időpont, legalább 2 különböző napra, 7:00 és 22:00 között, legalább 48 órával előre.";

function ProposeForm({ clubs, result }: { clubs: { id: number; name: string }[]; result?: ActionResult }) {
  const busy = useNavigation().state !== "idle";
  const [rows, setRows] = useState(3);
  const errors = result?.intent === "propose" && !result.ok ? (result.rows ?? {}) : {};
  return (
    <Form method="post" className="grid gap-3">
      <input type="hidden" name="intent" value="propose" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="grid content-start gap-1">
            <Label htmlFor={`slot-${i}`}>{i + 1}. időpont</Label>
            <Input
              id={`slot-${i}`}
              name="slot"
              type="datetime-local"
              step={900}
              lang="hu"
              className="w-full"
              aria-invalid={errors[i] ? true : undefined}
              aria-describedby={errors[i] ? `slot-${i}-error` : undefined}
            />
            {errors[i] && (
              <p id={`slot-${i}-error`} className="text-sm text-destructive">
                {errors[i]}
              </p>
            )}
          </div>
        ))}
      </div>
      {rows < MAX_SLOTS && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((n) => n + 1)}>
            <Plus />
            Még egy időpont
          </Button>
        </div>
      )}
      <ClubSelect clubs={clubs} id="propose-club" />
      <Feedback result={result} intent="propose" />
      <div>
        <Button type="submit" disabled={busy}>
          Elküldöm az időpontokat
        </Button>
      </div>
    </Form>
  );
}

const AGREED_HELP = "Ha Messengeren vagy személyesen megegyeztetek, rögzítsd az időpontot. A másik pár megerősíti, és a meccs le van fixálva.";

function AgreedForm({ clubs, result }: { clubs: { id: number; name: string }[]; result?: ActionResult }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Form method="post" className="grid gap-3">
      <p className="text-sm text-muted-foreground">{AGREED_HELP}</p>
      <input type="hidden" name="intent" value="agreed" />
      <div className="grid gap-1">
        <Label htmlFor="agreed-slot">Megbeszélt időpont</Label>
        <Input id="agreed-slot" name="slot" type="datetime-local" step={900} lang="hu" required className="w-full sm:w-72" />
      </div>
      <ClubSelect clubs={clubs} id="agreed-club" />
      <Feedback result={result} intent="agreed" />
      <div>
        <Button type="submit" variant="outline" disabled={busy}>
          Rögzítem az időpontot
        </Button>
      </div>
    </Form>
  );
}

// Whoever booked the court records where (#27); both pairs see it. Only the
// city's active clubs; the court is optional free text.
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
  const current = clubs.some((c) => c.id === clubId) ? String(clubId) : undefined;
  return (
    <Form method="post" className="grid gap-3">
      <input type="hidden" name="intent" value="venue" />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="venue-club">Helyszín</Label>
          <Select name="club" defaultValue={current} required>
            <SelectTrigger id="venue-club" className="w-full">
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
        <div className="grid gap-1.5">
          <Label htmlFor="venue-court">Pálya (nem kötelező)</Label>
          <Input id="venue-court" name="court" defaultValue={court ?? ""} maxLength={COURT_MAX} placeholder="pl. 2-es pálya" className="w-full" />
        </div>
      </div>
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
    ? "24 órán belül vagytok a kezdéshez képest, ez késői lemondás: utána nektek kell új időpontokat ajánlani, és ha a határidőig nem játsszátok le a meccset, az ellenfeletek nyer 4-0 4-0-val."
    : "Utána újra egyeztettek. 24 órán belül a kezdéshez képest a lemondás már késői: akkor nektek kell új időpontokat ajánlani.";
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
          Ha a lefixált időpontban nem jelentek meg, jelezd. A szervező dönt: ha jóváhagyja, 4-0 4-0-val nyertek, és ők fekete pontot kapnak.
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
                    ? "A szervező jóváhagyta a bejelentéseteket: 4-0 4-0 nektek."
                    : "A szervező jóváhagyta, hogy nem jöttetek el: 0-4 0-4, és fekete pontot kaptatok."
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
                A szervező értesítést kap, és ő dönt. Ha jóváhagyja, 4-0 4-0-val nyertek, az ellenfeletek fekete pontot kap. Amíg nem döntött, visszavonhatod.
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
      return `${formatSlot(m.state.slot)} (megerősítésre vár)`;
    case "proposed":
      return "Ajánlott időpontok várnak választásra";
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
  const where = m.state.status === "scheduled" ? venueLine(m.venue, m.state.court) : m.venue;
  const failed = (intent: string) => result?.intent === intent && !result.ok;
  const keyed = m.log.length;

  // The one main step (D133). Everything else is folded below it.
  const confirmResult = r.status === "recorded" && m.resultActions.confirm;
  const recordMain = r.status === "none" && m.resultActions.record && m.started;
  const recordFolded = m.resultActions.record && !recordMain && !confirmResult;
  const venueMain = m.state.status === "scheduled" && m.actions.venue && !m.started && m.state.clubId === null && m.clubs.length > 0;
  const proposeMain = m.actions.propose && m.state.status === "to_schedule";
  const substitutesShown = m.substitutes.approved.length > 0 || m.substitutes.ours.length > 0;
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
                {where ?? "Még nincs megadva"}
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
              <RecordResult key={`r${keyed}`} m={m} feedback={result} />
            </Panel>
          )}

          {m.state.status === "proposed" && theirs && m.actions.accept.length > 0 && (
            <Panel title="Válassz egy időpontot" description={m.venue ? `Helyszín: ${m.venue}.` : undefined} tone="main">
              <Form method="post" className="grid gap-3">
                <input type="hidden" name="intent" value="accept" />
                <RadioGroup name="slot" required aria-label="Ajánlott időpontok" className="grid gap-2 sm:grid-cols-2">
                  {m.actions.accept.map((s) => {
                    const id = `accept-${s.getTime()}`;
                    return (
                      <Label
                        key={s.getTime()}
                        htmlFor={id}
                        className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 font-normal has-[[data-state=checked]]:border-nav-active has-[[data-state=checked]]:bg-nav-active-bg"
                      >
                        <RadioGroupItem value={String(s.getTime())} id={id} aria-label={formatSlot(s)} />
                        <span className="grid">
                          <span className="text-sm text-muted-foreground">{formatSlot(s).replace(/ \d{1,2}:\d{2}$/, "")}</span>
                          <span className="text-lg font-bold tabular-nums">{formatSlot(s).match(/\d{1,2}:\d{2}$/)?.[0]}</span>
                        </span>
                      </Label>
                    );
                  })}
                </RadioGroup>
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
              description={`Az ellenfeletek szerint így beszéltétek meg: ${formatSlot(m.state.slot)}${m.venue ? `, ${m.venue}` : ""}.`}
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
              title={m.state.status === "proposed" ? "Ezeket ajánlottátok" : "Ezt rögzítettétek"}
              description={m.state.status === "proposed" ? "A másik pár választ egyet, vagy újakat ajánl." : "A másik pár megerősíti, vagy újra egyeztettek."}
            >
              <ul className="flex flex-wrap gap-2 text-sm">
                {(m.state.status === "proposed" ? m.state.slots : m.state.status === "agreed_time" ? [m.state.slot] : []).map((s) => (
                  <li key={s.getTime()} className="rounded-md bg-muted px-2.5 py-1.5 font-medium">
                    {formatSlot(s)}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {proposeMain && (
            <Panel
              title={m.state.status === "to_schedule" && m.state.nextBy === m.side ? "Ajánljatok új időpontokat" : "Ajánljatok időpontokat"}
              description={PROPOSE_RULES}
              tone="main"
            >
              <ProposeForm key={`p${keyed}`} clubs={m.clubs} result={result} />
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

          {substitutesShown && (
            <Panel title="Helyettes">
              <SubstituteBody key={`s${m.substitutes.ours.length}`} s={m.substitutes} deadline={m.deadline} result={result} />
            </Panel>
          )}

          {/* --- Everything else, folded --------------------------------------- */}

          {m.actions.propose && !proposeMain && (
            <Fold title={theirs ? "Egyik sem jó? Ajánljatok másik időpontokat" : "Új időpontokat ajánlanátok?"} hint={PROPOSE_RULES} open={failed("propose")}>
              <ProposeForm key={`p${keyed}`} clubs={m.clubs} result={result} />
            </Fold>
          )}

          {m.actions.recordAgreed && (
            <Fold title="Máshol már megbeszéltétek?" hint="Rögzítsd az időpontot, a másik pár megerősíti." open={failed("agreed")}>
              <AgreedForm key={`a${keyed}`} clubs={m.clubs} result={result} />
            </Fold>
          )}

          {m.state.status === "scheduled" && m.actions.venue && !venueMain && m.clubs.length > 0 && (
            <Fold title={m.state.clubId ? "Helyszín módosítása" : "Hol lesz a meccs?"} hint="Aki lefoglalta a pályát, írja be, hol." open={failed("venue")}>
              <VenueForm key={`v${keyed}`} clubs={m.clubs} clubId={m.state.clubId} court={m.state.court ?? null} result={result} />
            </Fold>
          )}

          {recordFolded && (
            <Fold
              title={r.status === "recorded" ? "Elírtátok? Javítsd ki" : "Már lejátszottátok? Rögzítsd az eredményt"}
              hint={r.status === "recorded" ? "A 48 óra újraindul." : "Ha a meccs megvolt, itt írjátok be."}
              open={failed("result-record")}
            >
              <RecordResult key={`r${keyed}`} m={m} feedback={result} />
            </Fold>
          )}

          {m.state.status === "scheduled" && m.actions.cancel && (
            <Fold title="Mégsem jó az időpont?" hint={m.cancelLate ? "Késői lemondás: 24 órán belül vagytok." : "Lemondhatjátok, utána újra egyeztettek."}>
              <CancelButton late={m.cancelLate} />
            </Fold>
          )}

          {m.noShow.canReport && !m.started && !noShowShown && (
            <Fold title="Nem jött el az ellenfél?" open={failed("no-show-report")}>
              <NoShowBody s={m.noShow} result={result} />
            </Fold>
          )}

          {m.substitutes.form && !substitutesShown && (
            <Fold title="Helyettes kell?" hint="Ha valamelyikőtök nem tud játszani." open={failed("substitute-request")}>
              <SubstituteBody key={`s${m.substitutes.ours.length}`} s={m.substitutes} deadline={m.deadline} result={result} />
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

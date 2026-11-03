import { Plus } from "lucide-react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requireUser } from "~/lib/auth/session.server";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { ResultSection } from "~/components/match-result";
import { COURT_MAX, SCHEDULING_GUIDE, formatSlot, groupLine, parseSlot, parseSlots, statusView } from "~/lib/matches";
import { matchPage, matchStep, NOT_FOUND, slotErrorText, type StepInput } from "~/lib/matches.server";
import { parseScore, resultStatusView } from "~/lib/results";
import { resultStep, type ResultInput } from "~/lib/results.server";
import { SITE_NAME } from "~/lib/site";

// A match (#25, #26): status, the opponents' phones, scheduling (propose,
// accept, counter-propose, record and confirm an agreed time) and the log.
// Only the two pairs' players see it; anyone else gets 404.

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
  const page = await matchPage(matchId(params), user.id);
  if (!page) throw new Response(NOT_FOUND, { status: 404 });
  return page;
}

const NONE = "none";
const MAX_SLOTS = 8;

type ActionResult = { intent: string; ok: boolean; message: string; rows?: Record<number, string> };

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
          : { kind: "dispute", score: parseScore(form, page.side), note: String(form.get("note") ?? "") };
    const done = await resultStep(user.id, id, input);
    if (done.ok) return data<ActionResult>({ intent, ok: true, message: done.notice });
    if (done.error === NOT_FOUND) throw new Response(NOT_FOUND, { status: 404 });
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
    input = { kind: "agreed", slot: slot || new Date(Number.NaN), clubId: club };
  } else if (intent === "accept") {
    const at = Number(form.get("slot"));
    if (!Number.isFinite(at)) return fail("Válassz egy időpontot.");
    input = { kind: "accept", slot: new Date(at) };
  } else if (intent === "confirm" || intent === "decline" || intent === "cancel") {
    input = { kind: intent };
  } else if (intent === "venue") {
    const club = clubId(form);
    if (club === undefined) return fail("Válassz helyszínt a listából.");
    input = { kind: "venue", clubId: club, court: String(form.get("court") ?? "") };
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

function Feedback({ result, intent }: { result: ActionResult | undefined; intent: string | string[] }) {
  if (!result || !(Array.isArray(intent) ? intent : [intent]).includes(result.intent)) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={result.ok ? "font-medium" : "font-semibold text-destructive"}>
      {result.message}
    </p>
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

function ProposeForm({ clubs, counter, result }: { clubs: { id: number; name: string }[]; counter: boolean; result?: ActionResult }) {
  const busy = useNavigation().state !== "idle";
  const [rows, setRows] = useState(3);
  const errors = result?.intent === "propose" && !result.ok ? (result.rows ?? {}) : {};
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">{counter ? "Új időpontok ajánlása" : "Időpontok ajánlása"}</CardTitle>
        <CardDescription>Legalább 3 időpont, legalább 2 különböző napra, 7:00 és 22:00 között, legalább 48 órával előre.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" className="grid gap-3">
          <input type="hidden" name="intent" value="propose" />
          {Array.from({ length: rows }, (_, i) => (
            <div key={i} className="grid gap-1">
              <Label htmlFor={`slot-${i}`}>{i + 1}. időpont</Label>
              <Input
                id={`slot-${i}`}
                name="slot"
                type="datetime-local"
                step={900}
                className="w-full sm:w-72"
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
      </CardContent>
    </Card>
  );
}

function AgreedForm({ clubs, result }: { clubs: { id: number; name: string }[]; result?: ActionResult }) {
  const busy = useNavigation().state !== "idle";
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">Már megbeszéltétek?</CardTitle>
        <CardDescription>
          Ha Messengeren vagy személyesen megegyeztetek, rögzítsd az időpontot. A másik pár megerősíti, és a meccs le van fixálva.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" className="grid gap-3">
          <input type="hidden" name="intent" value="agreed" />
          <div className="grid gap-1">
            <Label htmlFor="agreed-slot">Megbeszélt időpont</Label>
            <Input id="agreed-slot" name="slot" type="datetime-local" step={900} required className="w-full sm:w-72" />
          </div>
          <ClubSelect clubs={clubs} id="agreed-club" />
          <Feedback result={result} intent="agreed" />
          <div>
            <Button type="submit" variant="outline" disabled={busy}>
              Rögzítem az időpontot
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
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
  if (clubs.length === 0) return null;
  const current = clubs.some((c) => c.id === clubId) ? String(clubId) : undefined;
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">Hol lesz a meccs?</CardTitle>
        <CardDescription>Aki lefoglalta a pályát, írja be, hol. Mindkét pár látja.</CardDescription>
      </CardHeader>
      <CardContent>
        <Form method="post" className="grid gap-3">
          <input type="hidden" name="intent" value="venue" />
          <div className="grid gap-1.5">
            <Label htmlFor="venue-club">Helyszín</Label>
            <Select name="club" defaultValue={current} required>
              <SelectTrigger id="venue-club" className="w-full sm:w-72">
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
            <Input id="venue-court" name="court" defaultValue={court ?? ""} maxLength={COURT_MAX} placeholder="pl. 2-es pálya" className="w-full sm:w-72" />
          </div>
          <Feedback result={result} intent="venue" />
          <div>
            <Button type="submit" variant="outline" disabled={busy}>
              Mentem a helyszínt
            </Button>
          </div>
        </Form>
      </CardContent>
    </Card>
  );
}

// Either pair cancels the scheduled slot until it starts (#27, spec 6.6).
// Under 24 hours before it the cancellation is late, and the page says what
// that means before asking.
function CancelCard({ late }: { late: boolean }) {
  const busy = useNavigation().state !== "idle";
  const submit = useSubmit();
  const consequence = late
    ? "24 órán belül vagytok a kezdéshez képest, ez késői lemondás: utána nektek kell új időpontokat ajánlani, és ha a határidőig nem játsszátok le a meccset, az ellenfeletek nyer 4-0 4-0-val."
    : "Utána újra egyeztettek. 24 órán belül a kezdéshez képest a lemondás már késői: akkor nektek kell új időpontokat ajánlani.";
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="font-display text-lg">Mégsem jó az időpont?</CardTitle>
        <CardDescription>{consequence}</CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline" className="w-fit" disabled={busy}>
              Lemondom a meccset
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{late ? "Késői lemondás. Biztosan lemondod?" : "Lemondod a meccset?"}</AlertDialogTitle>
              <AlertDialogDescription>{consequence} A másik pár értesítést kap.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Mégse</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => submit({ intent: "cancel" }, { method: "post" })}>
                Lemondom
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

export default function MatchRoute({ loaderData: m, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const result = actionData as ActionResult | undefined;
  const status = resultStatusView(m.result, m.side) ?? statusView(m.state, m.side, m.venue);
  // The result goes first once there is one or the match is scheduled; before
  // that, scheduling comes first.
  const resultFirst = m.result.status !== "none" || m.state.status === "scheduled";
  const resultSection = <ResultSection key={`r${m.log.length}`} m={m} feedback={result} />;
  const theirs = m.state.status !== "to_schedule" && m.state.status !== "scheduled" && m.state.by !== m.side;
  return (
    <AppPage
      title={`${m.opponents} ellen`}
      description={`${groupLine(m.groupNumber, m.groupCount)} · ${m.week}. hét (${weekRange(m.phaseStartsAt, m.week)}) · határidő: ${formatDeadline(m.deadline)}`}
      back={{ to: "/home", label: "Kezdőlap" }}
    >
      <section className="grid max-w-2xl gap-3 rounded-lg border p-4 sm:p-6" aria-label="Állapot">
        <div>
          <StatusPill {...status} />
        </div>
        <p className="text-sm">
          <span className="font-medium">Ti:</span> {m.us}
        </p>
        {m.contacts.length > 0 && (
          <div className="grid gap-1">
            <p className="text-sm font-medium">Az ellenfeleitek telefonszáma:</p>
            <Contacts contacts={m.contacts} />
          </div>
        )}
        <Feedback result={result} intent={["accept", "confirm", "decline", "cancel"]} />
      </section>

      {resultFirst && resultSection}

      {m.state.status !== "scheduled" && m.actions.propose && (
        <section className="grid max-w-2xl gap-1 rounded-lg border border-dashed p-4 text-sm sm:p-6" aria-labelledby="hogyan">
          <h2 id="hogyan" className="font-semibold">
            Hogyan egyeztessetek?
          </h2>
          {SCHEDULING_GUIDE.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </section>
      )}

      {m.state.status === "proposed" && theirs && m.actions.accept.length > 0 && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="font-display text-lg">Válassz egy időpontot</CardTitle>
            <CardDescription>
              {m.venue ? `Helyszín: ${m.venue}. ` : ""}Egyik sem jó? Ajánljatok újakat lent.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-3">
              <input type="hidden" name="intent" value="accept" />
              <RadioGroup name="slot" required aria-label="Ajánlott időpontok">
                {m.actions.accept.map((s) => (
                  <div key={s.getTime()} className="flex items-center gap-2">
                    <RadioGroupItem value={String(s.getTime())} id={`accept-${s.getTime()}`} />
                    <Label htmlFor={`accept-${s.getTime()}`} className="font-normal">
                      {formatSlot(s)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <div>
                <Button type="submit" disabled={busy}>
                  Elfogadom
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}

      {m.state.status === "proposed" && !theirs && m.result.status === "none" && (
        <section className="grid max-w-2xl gap-1 rounded-lg border p-4 text-sm sm:p-6">
          <h2 className="font-semibold">Ezeket ajánlottátok</h2>
          <ul className="list-disc pl-5">
            {m.state.slots.map((s) => (
              <li key={s.getTime()}>{formatSlot(s)}</li>
            ))}
          </ul>
          <p className="text-muted-foreground">A másik pár választ egyet, vagy újakat ajánl.</p>
        </section>
      )}

      {m.state.status === "agreed_time" && m.actions.confirm && (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle className="font-display text-lg">Megerősíted az időpontot?</CardTitle>
            <CardDescription>
              Az ellenfeletek szerint így beszéltétek meg: {formatSlot(m.state.slot)}
              {m.venue ? `, ${m.venue}` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Form method="post">
              <input type="hidden" name="intent" value="confirm" />
              <Button type="submit" disabled={busy}>
                Megerősítem
              </Button>
            </Form>
            <Form method="post">
              <input type="hidden" name="intent" value="decline" />
              <Button type="submit" variant="outline" disabled={busy}>
                Nem így beszéltük
              </Button>
            </Form>
          </CardContent>
        </Card>
      )}

      {m.state.status === "scheduled" && m.actions.venue && (
        <VenueForm key={`v${m.log.length}`} clubs={m.clubs} clubId={m.state.clubId} court={m.state.court ?? null} result={result} />
      )}
      {m.state.status === "scheduled" && m.actions.cancel && <CancelCard late={m.cancelLate} />}

      {m.actions.propose && (
        <>
          {/* Keyed by the log, so the fields empty after each step. */}
          <ProposeForm key={`p${m.log.length}`} clubs={m.clubs} counter={theirs} result={result} />
          <AgreedForm key={`a${m.log.length}`} clubs={m.clubs} result={result} />
        </>
      )}

      {!resultFirst && resultSection}

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
                  {formatDateTime(e.at)} · {e.who} ({e.by === "organizer" ? "szervező" : e.by === "auto" ? "automatikus" : e.ours ? "ti" : "ellenfél"})
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


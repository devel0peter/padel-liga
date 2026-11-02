import { Plus } from "lucide-react";
import { useState } from "react";
import { data, Form, useNavigation } from "react-router";

import type { Route } from "./+types/match";
import { AppPage } from "~/components/app-page";
import { Contacts, StatusPill } from "~/components/my-group";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { requireUser } from "~/lib/auth/session.server";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { SCHEDULING_GUIDE, eventText, formatSlot, groupLine, parseSlot, parseSlots, statusView } from "~/lib/matches";
import { matchPage, matchStep, NOT_FOUND, slotErrorText, type StepInput } from "~/lib/matches.server";
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
  } else if (intent === "confirm" || intent === "decline") {
    input = { kind: intent };
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

export default function MatchRoute({ loaderData: m, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  const result = actionData as ActionResult | undefined;
  const status = statusView(m.state, m.side, m.venue);
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
        <Feedback result={result} intent={["accept", "confirm", "decline"]} />
      </section>

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

      {m.state.status === "proposed" && !theirs && (
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

      {m.actions.propose && (
        <>
          {/* Keyed by the log, so the fields empty after each step. */}
          <ProposeForm key={`p${m.log.length}`} clubs={m.clubs} counter={theirs} result={result} />
          <AgreedForm key={`a${m.log.length}`} clubs={m.clubs} result={result} />
        </>
      )}

      <section className="grid max-w-2xl gap-2" aria-labelledby="naplo">
        <h2 id="naplo" className="font-display text-lg font-bold">
          Napló
        </h2>
        {m.log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Még nem történt semmi.</p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {m.log.map((e) => (
              <li key={e.id} className="grid gap-0.5 rounded-md border p-3">
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(e.at)} · {e.who} ({e.ours ? "ti" : "ellenfél"})
                </span>
                <span className="break-words">{eventText(e)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </AppPage>
  );
}


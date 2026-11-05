import type { MatchScore, ResultState } from "@padel-liga/rules";
import { Form, useNavigation } from "react-router";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { NOTE_MAX, autoAcceptLine, outcomeText, scoreText } from "~/lib/results";

// The result on the match page (#28): record it, correct your own while it
// waits, confirm or dispute the other pair's; a disputed or final result is
// shown as it stands. The organizer's form (#29) uses ScoreFields too.

export type Feedback = { intent: string; ok: boolean; message: string } | undefined;

export function FormFeedback({ result, intent }: { result: Feedback; intent: string | string[] }) {
  if (!result || !(Array.isArray(intent) ? intent : [intent]).includes(result.intent)) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={result.ok ? "font-medium" : "font-semibold text-destructive"}>
      {result.message}
    </p>
  );
}

const ROWS = [
  { name: "set1", label: "1. szett" },
  { name: "set2", label: "2. szett" },
  { name: "stb", label: "Szuper tie-break (csak 1:1-nél)" },
] as const;

/**
 * Games per set in two columns (field names set1-us, set1-them, ...; see
 * results.ts parseScore). `columns`: the two headings, e.g. "Ti" and "Ők".
 * `values`: a prefill, the first column first; `required`: the two sets.
 */
export function ScoreFields({
  id,
  columns,
  values,
  required = true,
}: {
  id: string;
  columns: [string, string];
  values?: MatchScore | null;
  required?: boolean;
}) {
  const prefill = (row: (typeof ROWS)[number]["name"], i: 0 | 1) => {
    const pair = row === "stb" ? values?.superTieBreak : values?.sets[row === "set1" ? 0 : 1];
    return pair ? String(pair[i]) : undefined;
  };
  return (
    <fieldset className="grid gap-2">
      <legend className="sr-only">Eredmény</legend>
      <div className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-end gap-2 text-sm font-medium">
        <span />
        <span className="truncate text-center">{columns[0]}</span>
        <span className="truncate text-center">{columns[1]}</span>
      </div>
      {ROWS.map((r) => (
        <div key={r.name} className="grid grid-cols-[minmax(0,1fr)_4rem_4rem] items-center gap-2">
          <span className="text-sm">{r.label}</span>
          {(["us", "them"] as const).map((who, i) => (
            <Input
              key={who}
              id={`${id}-${r.name}-${who}`}
              name={`${r.name}-${who}`}
              aria-label={`${r.label}, ${columns[i]}`}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={2}
              autoComplete="off"
              className="text-center"
              defaultValue={prefill(r.name, i as 0 | 1)}
              required={required && r.name !== "stb"}
            />
          ))}
        </div>
      ))}
    </fieldset>
  );
}

type View = {
  side: "a" | "b";
  result: ResultState;
  resultActions: { record: boolean; confirm: boolean; dispute: boolean };
  autoAcceptAt: Date | null;
};

export function ResultSection({ m, feedback }: { m: View; feedback: Feedback }) {
  const busy = useNavigation().state !== "idle";
  const r = m.result;
  return (
    <section id="eredmeny" className="grid max-w-2xl scroll-mt-20 gap-3" aria-labelledby="eredmeny-cim">
      <h2 id="eredmeny-cim" className="font-display text-lg font-bold">
        Eredmény
      </h2>
      {/* A confirmation or dispute closes its card, so its notice shows here. */}
      {feedback?.ok && <FormFeedback result={feedback} intent={["result-confirm", "result-dispute"]} />}

      {r.status === "recorded" && m.resultActions.confirm && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Megerősíted az eredményt?</CardTitle>
            <CardDescription>
              Az ellenfeletek ezt rögzítette (ti vagytok elöl): <strong className="text-foreground">{scoreText(r.score, m.side)}</strong>.{" "}
              {m.autoAcceptAt && autoAcceptLine(m.autoAcceptAt)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Form method="post">
              <input type="hidden" name="intent" value="result-confirm" />
              <Button type="submit" disabled={busy}>
                Megerősítem
              </Button>
            </Form>
            {feedback && !feedback.ok && <FormFeedback result={feedback} intent="result-confirm" />}
          </CardContent>
        </Card>
      )}

      {r.status === "recorded" && m.resultActions.dispute && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">Nem így volt?</CardTitle>
            <CardDescription>Írd be, szerintetek mi lett az eredmény. A szervező dönt, addig a meccs nem számít.</CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-3">
              <input type="hidden" name="intent" value="result-dispute" />
              <ScoreFields id="dispute" columns={["Ti", "Ők"]} />
              <div className="grid gap-1.5">
                <Label htmlFor="dispute-note">Megjegyzés a szervezőnek (nem kötelező)</Label>
                <Textarea id="dispute-note" name="note" maxLength={NOTE_MAX} rows={2} />
              </div>
              {feedback && !feedback.ok && <FormFeedback result={feedback} intent="result-dispute" />}
              <div>
                <Button type="submit" variant="outline" disabled={busy}>
                  Vitatom az eredményt
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}

      {r.status === "recorded" && !m.resultActions.confirm && (
        <p className="text-sm">
          Rögzítettétek: <strong>{scoreText(r.score, m.side)}</strong>. A másik pár megerősítésére vár. {m.autoAcceptAt && autoAcceptLine(m.autoAcceptAt)}
        </p>
      )}

      {r.status === "disputed" && (
        <div className="grid gap-1 rounded-lg border p-4 text-sm sm:p-6">
          <p className="font-semibold">Vitatott eredmény, a szervező dönt. Addig a meccs nem számít.</p>
          <p>
            Rögzített eredmény (ti vagytok elöl): {scoreText(r.score, m.side)}
          </p>
          {r.counter && <p>A másik változat: {scoreText(r.counter, m.side)}</p>}
        </div>
      )}

      {r.status === "final" && (
        <p className="rounded-lg border p-4 text-sm sm:p-6">
          <span className="font-semibold">Végeredmény:</span> {outcomeText(r.outcome, m.side)}
          {r.how === "auto_accepted"
            ? " (48 óra után magától elfogadva)"
            : r.how === "organizer"
              ? " (a szervező döntése)"
              : r.how === "deadline"
                ? " (lejárt a határidő, a meccsnapló alapján)"
                : ""}
        </p>
      )}

      {m.resultActions.record && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display text-lg">{r.status === "recorded" ? "Elírtátok? Javítsd ki" : "Eredmény rögzítése"}</CardTitle>
            <CardDescription>
              Csak a végeredményt írd be: 2 nyert szettig, egy szett 4 nyert játékig (5:3, vagy tie-break után 5:4); 1:1-nél szuper tie-break 10 pontig. Ha
              félbemaradt a meccs, egy új időpontban fejezzétek be, és utána rögzítsétek.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="grid gap-3">
              <input type="hidden" name="intent" value="result-record" />
              <ScoreFields id="record" columns={["Ti", "Ők"]} />
              <FormFeedback result={feedback} intent="result-record" />
              <div>
                <Button type="submit" disabled={busy}>
                  {r.status === "recorded" ? "Javítom az eredményt" : "Rögzítem az eredményt"}
                </Button>
              </div>
            </Form>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

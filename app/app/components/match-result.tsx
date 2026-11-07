import { flipScore, type MatchScore, type ResultState, type Side } from "@padel-liga/rules";
import { ChevronRight } from "lucide-react";
import { Form, useNavigation } from "react-router";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { NOTE_MAX, autoAcceptLine, outcomeText, scoreText } from "~/lib/results";
import { cn } from "~/lib/utils";

// The result on the match page (#28, D133): record it, correct your own while
// it waits, confirm or dispute the other pair's; a disputed or final result is
// shown as it stands. The match page places these by the match's state. The
// organizer's form (#29) uses ScoreFields too.

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

// A score as a small board (D133): our pair on top, sets side by side, the
// super tie-break last, the winning numbers in bold. `score` is in a/b order.
export function ScoreBoard({ score, side, us, them }: { score: MatchScore; side: Side; us: string; them: string }) {
  const s = side === "a" ? score : flipScore(score);
  const cols = [...s.sets, ...(s.superTieBreak ? [s.superTieBreak] : [])];
  const won = (i: number) => cols.filter(([x, y]) => (i === 0 ? x > y : y > x)).length;
  const winner = s.superTieBreak ? (s.superTieBreak[0] > s.superTieBreak[1] ? 0 : 1) : won(0) > won(1) ? 0 : 1;
  return (
    <table className="w-full max-w-sm border-separate border-spacing-y-1 text-sm" aria-label="Eredmény">
      <thead className="sr-only">
        <tr>
          <th>Pár</th>
          {cols.map((_, i) => (
            <th key={i}>{i < s.sets.length ? `${i + 1}. szett` : "Szuper tie-break"}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {[us, them].map((name, row) => (
          <tr key={row}>
            <th scope="row" className={cn("pr-3 text-left break-words", row === winner ? "font-bold" : "font-normal text-muted-foreground")}>
              {name}
              {row === winner && <span className="ml-1.5 rounded bg-emerald-100 px-1 text-[10px] font-bold text-emerald-800 uppercase">nyert</span>}
            </th>
            {cols.map((c, i) => (
              <td
                key={i}
                className={cn(
                  "h-9 w-9 rounded-md bg-muted text-center text-base tabular-nums",
                  c[row]! > c[1 - row]! ? "font-extrabold text-foreground" : "font-medium text-muted-foreground",
                  i >= s.sets.length && "text-sm",
                )}
              >
                {c[row]}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type View = {
  side: Side;
  us: string;
  opponents: string;
  result: ResultState;
  resultActions: { record: boolean; confirm: boolean; dispute: boolean };
  autoAcceptAt: Date | null;
};

// The result as it stands (D77): ours waiting, disputed or final. Nothing to do.
export function ResultStatus({ m }: { m: View }) {
  const r = m.result;
  if (r.status === "recorded" && !m.resultActions.confirm)
    return (
      <p className="text-sm">
        Rögzítettétek: <strong>{scoreText(r.score, m.side)}</strong>. A másik pár megerősítésére vár. {m.autoAcceptAt && autoAcceptLine(m.autoAcceptAt)}
      </p>
    );
  if (r.status === "disputed")
    return (
      <div className="grid gap-1 text-sm">
        <p className="font-semibold">Vitatott eredmény, a szervező dönt. Addig a meccs nem számít.</p>
        <p>Rögzített eredmény (ti vagytok elöl): {scoreText(r.score, m.side)}</p>
        {r.counter && <p>A másik változat: {scoreText(r.counter, m.side)}</p>}
      </div>
    );
  if (r.status === "final")
    return (
      <p className="text-sm">
        <span className="font-semibold">Végeredmény:</span> {outcomeText(r.outcome, m.side)}
        {r.how === "auto_accepted"
          ? " (48 óra után magától elfogadva)"
          : r.how === "organizer"
            ? " (a szervező döntése)"
            : r.how === "deadline"
              ? " (lejárt a határidő, a meccsnapló alapján)"
              : ""}
      </p>
    );
  return null;
}

// The other pair's result waits for us (D77): confirming is the main step;
// the dispute form opens from "Nem így volt?".
export function ConfirmResult({ m, feedback }: { m: View; feedback: Feedback }) {
  const busy = useNavigation().state !== "idle";
  const r = m.result;
  if (r.status !== "recorded") return null;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1">
        <p className="font-display text-lg font-bold">Megerősíted az eredményt?</p>
        <p className="text-sm text-muted-foreground">
          Az ellenfeletek ezt rögzítette (ti vagytok elöl): <strong className="text-foreground">{scoreText(r.score, m.side)}</strong>.{" "}
          {m.autoAcceptAt && autoAcceptLine(m.autoAcceptAt)}
        </p>
      </div>
      <ScoreBoard score={r.score} side={m.side} us={m.us} them={m.opponents} />
      {m.resultActions.confirm && (
        <Form method="post">
          <input type="hidden" name="intent" value="result-confirm" />
          <Button type="submit" size="lg" disabled={busy}>
            Megerősítem
          </Button>
        </Form>
      )}
      {feedback && !feedback.ok && <FormFeedback result={feedback} intent="result-confirm" />}
      {m.resultActions.dispute && (
        <details className="group rounded-lg border" open={feedback?.intent === "result-dispute" && !feedback.ok}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-4 shrink-0 transition-transform group-open:rotate-90" />
            Nem így volt?
          </summary>
          <Form method="post" className="grid gap-3 border-t p-3">
            <p className="text-sm text-muted-foreground">Írd be, szerintetek mi lett az eredmény. A szervező dönt, addig a meccs nem számít.</p>
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
        </details>
      )}
    </div>
  );
}

export const RESULT_HELP =
  "Csak a végeredményt írd be: 2 nyert szettig, egy szett 4 nyert játékig (5:3, vagy tie-break után 5:4); 1:1-nél szuper tie-break 10 pontig. Ha félbemaradt a meccs, egy új időpontban fejezzétek be, és utána rögzítsétek.";

// Recording the result, or correcting ours while it waits (D77).
export function RecordResult({ m, feedback }: { m: View; feedback: Feedback }) {
  const busy = useNavigation().state !== "idle";
  const correcting = m.result.status === "recorded";
  return (
    <Form method="post" className="grid gap-3">
      <p className="text-sm text-muted-foreground">{RESULT_HELP}</p>
      <input type="hidden" name="intent" value="result-record" />
      <ScoreFields id="record" columns={["Ti", "Ők"]} />
      {feedback && !feedback.ok && <FormFeedback result={feedback} intent="result-record" />}
      <div>
        <Button type="submit" disabled={busy}>
          {correcting ? "Javítom az eredményt" : "Rögzítem az eredményt"}
        </Button>
      </div>
    </Form>
  );
}

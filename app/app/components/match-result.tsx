import { flipScore, type MatchScore, type ResultState, type SetGames, type Side } from "@padel-liga/rules";
import { ChevronRight } from "lucide-react";
import { Form, useNavigation } from "react-router";

import { ScoreBoard } from "~/components/blocks";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { NOTE_MAX, autoAcceptLine, outcomeText, resultHelp, scoreText } from "~/lib/results";

// The result on the match page (#28, D133): record it, correct your own while
// it waits, confirm or dispute the other pair's; a disputed or final result is
// shown as it stands. The match page places these by the match's state. The
// organizer's form (#29) uses ScoreFields too.

export type Feedback = { intent: string; ok: boolean; message: string } | undefined;

export function FormFeedback({ result, intent }: { result: Feedback; intent: string | string[] }) {
  if (!result || !(Array.isArray(intent) ? intent : [intent]).includes(result.intent)) return null;
  return (
    <p role={result.ok ? "status" : "alert"} className={result.ok ? "font-medium" : "font-semibold text-danger"}>
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

// A score as the scoreboard block (D181, #421): our pair on top, a box per
// set, the super tie-break last, the winner marked. `score` is in a/b order.
export function ResultBoard({ score, side, us, them }: { score: MatchScore; side: Side; us: string; them: string }) {
  const s = side === "a" ? score : flipScore(score);
  const sets = [...s.sets, ...(s.superTieBreak ? [s.superTieBreak] : [])];
  const won = (i: 0 | 1) => s.sets.filter(([x, y]) => (i === 0 ? x > y : y > x)).length;
  const winner = s.superTieBreak ? (s.superTieBreak[0] > s.superTieBreak[1] ? 0 : 1) : won(0) > won(1) ? 0 : 1;
  return <ScoreBoard teams={[us, them]} sets={sets} winner={winner} />;
}

type View = {
  side: Side;
  us: string;
  opponents: string;
  result: ResultState;
  resultActions: { record: boolean; confirm: boolean; dispute: boolean };
  autoAcceptAt: Date | null;
  // The round's set format (D173, #396).
  setGames: SetGames;
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
        <span className="font-semibold">Végeredmény:</span> {outcomeText(r.outcome, m.side, m.setGames)}
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
        <h2 className="m-0 text-[22px] leading-tight font-extrabold md:text-[26px]">Megerősíted az eredményt?</h2>
        <p className="text-sm text-muted-foreground">
          Az ellenfeletek ezt rögzítette (ti vagytok elöl): <strong className="text-foreground">{scoreText(r.score, m.side)}</strong>.{" "}
          {m.autoAcceptAt && autoAcceptLine(m.autoAcceptAt)}
        </p>
      </div>
      <ResultBoard score={r.score} side={m.side} us={m.us} them={m.opponents} />
      {m.resultActions.confirm && (
        <Form method="post" className="grid sm:flex">
          <input type="hidden" name="intent" value="result-confirm" />
          <Button type="submit" size="xl" disabled={busy}>
            Megerősítem
          </Button>
        </Form>
      )}
      {feedback && !feedback.ok && <FormFeedback result={feedback} intent="result-confirm" />}
      {m.resultActions.dispute && (
        <details className="group rounded-xl bg-surface-2" open={feedback?.intent === "result-dispute" && !feedback.ok}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 font-semibold [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
            Nem így volt?
          </summary>
          <Form method="post" className="grid gap-3 border-t border-hairline p-3.5">
            <p className="text-sm text-muted-foreground">Írd be, szerintetek mi lett az eredmény. A szervező dönt, addig a meccs nem számít.</p>
            <input type="hidden" name="intent" value="result-dispute" />
            <ScoreFields id="dispute" columns={["Ti", "Ők"]} />
            <div className="grid gap-1.5">
              <Label htmlFor="dispute-note">Megjegyzés a szervezőnek (nem kötelező)</Label>
              <Textarea id="dispute-note" name="note" maxLength={NOTE_MAX} rows={2} />
            </div>
            {feedback && !feedback.ok && <FormFeedback result={feedback} intent="result-dispute" />}
            <div>
              <Button type="submit" variant="secondary" size="xl" disabled={busy}>
                Vitatom az eredményt
              </Button>
            </div>
          </Form>
        </details>
      )}
    </div>
  );
}

// Recording the result, or correcting ours while it waits (D77). `children`:
// more fields above the button (the match page's venue, D146).
// `primary`: the page's main step, the one yellow button (D181); folded, a secondary one.
export function RecordResult({
  m,
  feedback,
  primary = false,
  children,
}: {
  m: View;
  feedback: Feedback;
  primary?: boolean;
  children?: React.ReactNode;
}) {
  const busy = useNavigation().state !== "idle";
  const correcting = m.result.status === "recorded";
  return (
    <Form method="post" className="grid gap-3">
      <p className="text-sm text-muted-foreground">{resultHelp(m.setGames)}</p>
      <input type="hidden" name="intent" value="result-record" />
      <ScoreFields id="record" columns={["Ti", "Ők"]} />
      {children}
      {feedback && !feedback.ok && <FormFeedback result={feedback} intent="result-record" />}
      <div>
        <Button type="submit" size="xl" variant={primary ? "default" : "secondary"} disabled={busy}>
          {correcting ? "Javítom az eredményt" : "Rögzítem az eredményt"}
        </Button>
      </div>
    </Form>
  );
}

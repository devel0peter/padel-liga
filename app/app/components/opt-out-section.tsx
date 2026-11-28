import { useFetcher } from "react-router";

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
import { CANCEL, OPT_OUT, UNDO_OPT_OUT, type OptOutView } from "~/lib/opt-out";

// "Nem folytatom" and "Mégis folytatom" on a Ligáim card (#395): the line
// (default in with the deadline, the opt-out, or that the pair doesn't play
// on) and the button its state offers. "Nem folytatom" asks first. Both post
// to the page's own action (intent "opt_out" or "undo_opt_out"), which
// answers with an error or ok; the card then shows the new state.

type Answer = { ok?: true; error?: string };

export function OptOutForm({ seasonId, view }: { seasonId: number; view: OptOutView }) {
  const fetcher = useFetcher<Answer>();
  const busy = fetcher.state !== "idle";
  const send = (intent: "opt_out" | "undo_opt_out") => fetcher.submit({ intent, season: String(seasonId) }, { method: "post" });
  return (
    <div className="grid gap-1">
      <p className="m-0 font-semibold">{view.text}</p>
      {view.action === "opt_out" && view.confirm && (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="link" className="h-11 justify-self-start px-0 text-muted-foreground underline" disabled={busy}>
              {OPT_OUT}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{view.confirm.title}</AlertDialogTitle>
              <AlertDialogDescription>{view.confirm.text}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{CANCEL}</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => send("opt_out")}>
                {OPT_OUT}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {view.action === "undo" && (
        <Button variant="secondary" size="xl" className="justify-self-start" disabled={busy} onClick={() => send("undo_opt_out")}>
          {UNDO_OPT_OUT}
        </Button>
      )}
      {fetcher.state === "idle" && fetcher.data?.error && (
        <p role="alert" className="m-0 font-semibold text-danger">
          {fetcher.data.error}
        </p>
      )}
    </div>
  );
}

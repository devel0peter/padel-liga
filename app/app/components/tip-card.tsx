import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Lightbulb } from "lucide-react";

import { usePushDevice } from "~/components/use-push-device";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import { tipById, tipCardParts, tipToShow, type Tip } from "~/lib/tips";

// The Kezdőlap's tip (#262, D160): at most one, the first of the offered
// tips (the server's list: not dismissed, offered to this account) that
// applies on this device. Below the page's main content, never a pop-up.
// "Most nem" posts to /home and hides it at once; doing the thing (e.g.
// subscribing) makes it no longer apply, so it goes at once too.
export function TipCard({ offered, vapidPublicKey }: { offered: string[]; vapidPublicKey: string | null }) {
  const push = usePushDevice(vapidPublicKey, { resync: false });
  const dismiss = useFetcher();
  const [dismissed, setDismissed] = useState<string[]>([]);
  const tips = offered.flatMap((id) => (dismissed.includes(id) ? [] : (tipById(id) ?? [])));
  const tip = tipToShow(tips, { push: push.state });
  if (!tip) return null;

  function later(t: Tip) {
    setDismissed((d) => [...d, t.id]);
    dismiss.submit({ intent: "dismiss_tip", tip: t.id }, { method: "post", action: "/home" });
  }

  // The button, or the how-to-allow line instead (tipCardParts).
  const parts = tipCardParts(tip, { push: push.state });
  return (
    <Card role="region" aria-label="Tipp" size="sm" className="max-w-2xl">
      <CardHeader>
        <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          <Lightbulb aria-hidden className="size-3.5" />
          Tipp
        </p>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">
          {tip.title}
        </CardTitle>
        <CardDescription>{tip.text}</CardDescription>
      </CardHeader>
      {(parts.notice || push.error) && (
        <CardContent className="grid gap-2 text-sm">
          {parts.notice && <p>{parts.notice}</p>}
          {push.error && <p className="text-destructive">{push.error}</p>}
        </CardContent>
      )}
      <CardFooter className="flex flex-wrap gap-2">
        {parts.button &&
          (tip.action.kind === "push" ? (
            <Button type="button" disabled={push.busy} onClick={() => void push.subscribe()}>
              {tip.button}
            </Button>
          ) : (
            <Button asChild>
              <Link to={tip.action.to}>{tip.button}</Link>
            </Button>
          ))}
        <Button type="button" variant="ghost" onClick={() => later(tip)}>
          Most nem
        </Button>
      </CardFooter>
    </Card>
  );
}

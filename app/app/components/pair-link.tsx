import { useEffect, useState } from "react";

import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { PAIR_LINK_SHARE_TEXT, PAIR_LINK_TEXT, PAIR_LINK_TITLE } from "~/lib/pairs";

// The player's own pair link (2026-10-31), on /home and in Párod while they
// have no pair in the league: the link to copy, and the phone's share sheet
// where there is one. `url` is absolute (built from the request's origin).

export const COPIED = "Kimásolva.";

export function PairLinkBox({ url, league, bare = false }: { url: string; league?: string; bare?: boolean }) {
  const [copied, setCopied] = useState(false);
  // navigator.share exists only in the browser, and not in every one.
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator.share === "function"), []);
  const id = `pair-link-${url.slice(-8)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard access: select the text so it can be copied by hand.
      (document.getElementById(id) as HTMLInputElement | null)?.select();
    }
  }

  async function share() {
    try {
      await navigator.share({ text: PAIR_LINK_SHARE_TEXT, url });
    } catch {
      // Cancelled.
    }
  }

  const controls = (
    <div className="grid gap-3">
      <Input id={id} aria-label="A meghívó linked" readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-11 font-mono text-sm" />
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" onClick={copy} className="h-11 px-5">
          Link másolása
        </Button>
        {canShare && (
          <Button type="button" variant="outline" onClick={share} className="h-11 px-5">
            Megosztás
          </Button>
        )}
        {copied && (
          <span role="status" className="text-sm font-medium">
            {COPIED}
          </span>
        )}
      </div>
    </div>
  );
  // Inside a card of its own page (Profil's Párod section, D140): no card around it.
  if (bare)
    return (
      <div className="grid content-start gap-3">
        <div className="grid gap-1">
          <h3 className="font-display text-base font-bold">{PAIR_LINK_TITLE}</h3>
          <p>{PAIR_LINK_TEXT}</p>
        </div>
        {controls}
      </div>
    );
  return (
    <Card className="max-w-2xl border-nav-active">
      <CardHeader>
        <CardTitle className="font-display text-lg">{PAIR_LINK_TITLE}</CardTitle>
        {league && <CardDescription>{league}</CardDescription>}
        <CardDescription className="text-foreground">{PAIR_LINK_TEXT}</CardDescription>
      </CardHeader>
      <CardContent>{controls}</CardContent>
    </Card>
  );
}

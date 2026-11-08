import { Copy, Mail, MessageSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { groupMessage, smsPlatform, type SmsPlatform } from "~/lib/group-message";
import type { GroupMessageData } from "~/lib/matches.server";

// "Írj mindenkinek" (D147), under the opponents' contacts on the match page
// and on Kezdőlap: the phone's SMS app or email app opens with the partner
// and both opponents and a short text; the app itself sends nothing. `url`:
// the match page, absolute.

export const COPIED = "Kimásoltuk.";

export function GroupMessage({ message, week, url }: { message: GroupMessageData | null; week: number; url: string }) {
  // The SMS link's form depends on the phone; the server renders Android's.
  const [platform, setPlatform] = useState<SmsPlatform>("android");
  useEffect(() => setPlatform(smsPlatform(navigator.userAgent, navigator.maxTouchPoints)), []);
  const [copied, setCopied] = useState<"ok" | "by-hand" | null>(null);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (copied === "by-hand") field.current?.select();
  }, [copied]);

  if (!message || message.to.length === 0) return null;
  const m = groupMessage(message.to, { week, us: message.us, them: message.them, url }, platform);

  async function copy() {
    try {
      await navigator.clipboard.writeText(m.phones);
      setCopied("ok");
    } catch {
      // No clipboard access: show the numbers selected, to copy by hand.
      setCopied("by-hand");
    }
  }

  // Stacked full width on a phone (the three don't fit one row), in a row from sm.
  const button = "h-10 justify-start px-3 sm:justify-center";
  return (
    <div className="grid gap-2" role="group" aria-label="Írj mindenkinek">
      <p className="text-sm font-medium">Írj mindenkinek egyszerre, a párodnak és az ellenfeleknek:</p>
      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {m.sms && (
          <Button asChild variant="outline" className={button}>
            <a href={m.sms} className="no-underline">
              <MessageSquare aria-hidden className="text-court" />
              SMS mindenkinek
            </a>
          </Button>
        )}
        {m.mailto && (
          <Button asChild variant="outline" className={button}>
            <a href={m.mailto} className="no-underline">
              <Mail aria-hidden className="text-court" />
              E-mail mindenkinek
            </a>
          </Button>
        )}
        {m.sms && (
          <Button type="button" variant="outline" onClick={copy} className={button}>
            <Copy aria-hidden className="text-court" />
            Számok másolása
          </Button>
        )}
      </div>
      {copied === "ok" && (
        <p role="status" className="text-sm font-medium">
          {COPIED}
        </p>
      )}
      {copied === "by-hand" && (
        <Input
          ref={field}
          aria-label="A telefonszámok"
          readOnly
          value={m.phones}
          onFocus={(e) => e.currentTarget.select()}
          className="h-10 font-mono text-sm"
        />
      )}
      {m.noPhone.length > 0 && <p className="text-sm text-muted-foreground">Nincs telefonszáma: {m.noPhone.join(", ")}</p>}
      {m.noEmail.length > 0 && <p className="text-sm text-muted-foreground">Nincs e-mail-címe: {m.noEmail.join(", ")}</p>}
    </div>
  );
}

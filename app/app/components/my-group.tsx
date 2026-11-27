import { Mail, Phone } from "lucide-react";

import { telHref, type Tone } from "~/lib/matches";
import { cn } from "~/lib/utils";

// The match pages' status pill and the opponents' contacts (D135). Kezdőlap
// has its own parts since #420 (home-round.tsx).

const TONE: Record<Tone, string> = {
  todo: "bg-nav-active-bg text-nav-active",
  waiting: "bg-muted text-muted-foreground",
  done: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-block rounded-md px-2 py-1 text-xs font-semibold", TONE[tone])}>{label}</span>;
}

export type Contact = { name: string; phone: string; email?: string | null };

// The other pair's players while the match is to be played (D135): tap to
// call, tap to write. Big enough for a thumb (40 px rows).
export function Contacts({ contacts, className }: { contacts: Contact[]; className?: string }) {
  if (contacts.length === 0) return null;
  const link = "inline-flex min-h-10 min-w-0 items-center gap-1.5 no-underline hover:underline";
  return (
    <ul className={cn("grid gap-2", className)} aria-label="Az ellenfelek elérhetősége">
      {contacts.map((c) => (
        <li key={c.name} className="flex min-w-0 flex-wrap items-center gap-x-4 rounded-lg border bg-background px-3 py-1 text-sm">
          <span className="w-full pt-1 font-semibold break-words sm:w-auto sm:pt-0">{c.name}</span>
          {c.phone ? (
            <a href={telHref(c.phone)} className={link}>
              <Phone aria-hidden className="size-4 shrink-0 text-court" />
              <span className="sr-only">Hívás: </span>
              {c.phone}
            </a>
          ) : (
            <span className="inline-flex min-h-10 items-center text-muted-foreground">Nincs telefonszám</span>
          )}
          {c.email && (
            <a href={`mailto:${c.email}`} className={link}>
              <Mail aria-hidden className="size-4 shrink-0 text-court" />
              <span className="sr-only">E-mail: </span>
              <span className="min-w-0 [overflow-wrap:anywhere]">{c.email}</span>
            </a>
          )}
        </li>
      ))}
    </ul>
  );
}

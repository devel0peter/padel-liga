import { Check } from "lucide-react";
import { Link, useFetcher } from "react-router";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "~/components/ui/card";
import type { SurnameView } from "~/lib/names.server";
import { cn } from "~/lib/utils";

// The surname choice (#419, D182, mockups P08 and P10): which part of the
// player's own name the tables show. Picking a part posts `intent=surname`
// with the part; no free text. Built with Tailwind and shadcn/ui until the
// #418 building blocks land.

export const SURNAME_INTENT = "surname";

// "Farkas / Papp", the player's own part highlighted.
function LabelPreview({ label, pending }: { label: SurnameView["label"]; pending?: string | null }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 rounded-lg bg-muted px-3 py-2 font-display text-xl font-extrabold tracking-tight uppercase">
      <span className="text-nav-active" data-testid="own-surname">
        {pending ?? label.own}
      </span>
      {label.partner && (
        <>
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <span className="sr-only">és</span>
          <span>{label.partner}</span>
        </>
      )}
    </p>
  );
}

/**
 * Kezdőlap's one-time card (P10) for a player whose surname the rules can't
 * tell and who hasn't answered: "Igen" keeps the first word, "Nem, a Lilla"
 * picks the other part. Either answer saves it, and the card is gone.
 */
export function SurnameCard({ view }: { view: SurnameView }) {
  const fetcher = useFetcher();
  // Gone at once on an answer; the reload confirms it.
  if (!view.asks || fetcher.state !== "idle" || fetcher.data) return null;
  const others = view.parts.filter((p) => p !== view.surname);
  const answer = (part: string) => fetcher.submit({ intent: SURNAME_INTENT, surname: part }, { method: "post", action: "/home" });
  return (
    <Card role="region" aria-label="Egy gyors kérdés" className="max-w-2xl border-nav-active/40">
      <CardHeader className="gap-3">
        <Badge variant="secondary" className="w-fit text-xs font-semibold tracking-wide [word-spacing:0.2em] uppercase">
          Egy gyors kérdés
        </Badge>
        <p className="text-sm">{view.label.partner ? "A tabellában így írjuk ki a csapatotokat:" : "A tabellában így írjuk ki a neved:"}</p>
        <LabelPreview label={view.label} />
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">
          A vezetékneved {view.surname}?
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        <Button type="button" size="lg" onClick={() => answer(view.surname)}>
          Igen
        </Button>
        {others.map((part) => (
          <Button key={part} type="button" size="lg" variant="secondary" onClick={() => answer(part)}>
            Nem, a {part}
          </Button>
        ))}
      </CardContent>
      <CardFooter>
        <p className="text-xs text-muted-foreground">
          Csak egyszer kérdezzük. Később a{" "}
          <Link to="/profile?tab=settings#neved-a-tabellaban" className="underline">
            Profilban
          </Link>{" "}
          is átállíthatod.
        </p>
      </CardFooter>
    </Card>
  );
}

/**
 * Profil → Beállítások, "Neved a tabellában" (P08): the label with the
 * player's part highlighted, and the parts of their name as chips. A tap
 * saves; the chips change the label on every page from the next load.
 */
export function SurnameSetting({ view }: { view: SurnameView }) {
  const fetcher = useFetcher();
  const pending = fetcher.formData?.get("surname");
  const chosen = typeof pending === "string" ? pending : view.surname;
  const failed = fetcher.state === "idle" && fetcher.data && typeof fetcher.data === "object" && "surnameError" in fetcher.data;
  return (
    <div className="grid gap-3">
      <LabelPreview label={view.label} pending={typeof pending === "string" ? pending : null} />
      {view.parts.length > 1 && (
        <fetcher.Form method="post" className="grid gap-2">
          <input type="hidden" name="intent" value={SURNAME_INTENT} />
          <p id="surname-question" className="text-sm font-medium">
            Melyik a vezetékneved?
          </p>
          <div role="group" aria-labelledby="surname-question" className="flex flex-wrap gap-2">
            {view.parts.map((part) => {
              const on = part === chosen;
              return (
                <button
                  key={part}
                  type="submit"
                  name="surname"
                  value={part}
                  aria-pressed={on}
                  disabled={fetcher.state !== "idle"}
                  className={cn(
                    "inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-70",
                    on ? "border-nav-active bg-nav-active-bg text-nav-active" : "bg-muted text-foreground hover:bg-accent",
                  )}
                >
                  {on && <Check aria-hidden className="size-4" />}
                  {part}
                </button>
              );
            })}
          </div>
        </fetcher.Form>
      )}
      {failed && (
        <p role="alert" className="text-sm font-semibold text-destructive">
          Ez már nem a neved része. Frissítsd az oldalt.
        </p>
      )}
      <p className="text-sm text-muted-foreground">A teljes neved a profilodon és a meccsoldalon marad.</p>
    </div>
  );
}

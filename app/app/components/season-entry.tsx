import { Form, Link, useNavigation } from "react-router";

import { Button } from "~/components/ui/button";
import { formatShortDate } from "~/lib/format";
import { PAIR_SECTION_PATH } from "~/lib/pairs";
import { fromPhase, WAITING_START, type EntryView } from "~/lib/season-entries";

// A season's entry for the player (#23), in Profil's Párod section and on the home page: the
// status (with a note left from the approval step), the "Nevezünk" button,
// or why they can't enter yet. The form posts intent "enter" to the page's
// own action. The entry counts at once (#153).

// What the player who clicked sees: entered, and from which round. startsAt
// null: a first season still waiting for its minimum entries (D124).
export function enteredNotice(joins: { phase: number; startsAt: Date | null } | null): string {
  if (joins === null) return "Beneveztetek: a következő szezontól játszotok.";
  if (joins.startsAt === null) return `Beneveztetek: ${fromPhase(joins.phase)} játszotok. ${WAITING_START}`;
  return `Beneveztetek: ${fromPhase(joins.phase)} játszotok (kezdés: ${formatShortDate(new Date(joins.startsAt))}).`;
}

const BLOCKED_LINKS: Partial<Record<Extract<EntryView, { kind: "blocked" }>["reason"], { to: string; label: string }>> = {
  no_pair: { to: PAIR_SECTION_PATH, label: "Párod a Profilban" },
  no_level: { to: "/profile?tab=settings#adatok", label: "Megadom a szintem" },
};

export function SeasonEntry({ seasonId, view }: { seasonId: number; view: EntryView }) {
  const busy = useNavigation().state !== "idle";
  if (view.kind === "status")
    return (
      <div className="grid gap-1">
        <p className="font-medium">{view.text}</p>
        {view.note && <p className="whitespace-pre-line text-muted-foreground">A szervező üzenete: {view.note}</p>}
      </div>
    );
  if (view.kind === "blocked") {
    const link = BLOCKED_LINKS[view.reason];
    return (
      <p className="text-muted-foreground">
        {view.text}{" "}
        {link && (
          <Link to={link.to} className="font-semibold text-foreground underline">
            {link.label}
          </Link>
        )}
      </p>
    );
  }
  return (
    <Form method="post" className="grid gap-2">
      <input type="hidden" name="intent" value="enter" />
      <input type="hidden" name="season" value={seasonId} />
      {view.late && (
        <p className="text-muted-foreground">
          A szezon már elindult, de még nevezhettek: a következő körtől játszotok.
        </p>
      )}
      <div>
        <Button type="submit" disabled={busy}>
          Nevezünk
        </Button>
      </div>
    </Form>
  );
}

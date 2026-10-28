import { Form, Link, useNavigation } from "react-router";

import { Button } from "~/components/ui/button";
import type { EntryView } from "~/lib/season-entries";

// A season's entry for the player (#23), on Párom and the home page: the
// status with the organizer's note, the "Nevezünk" button, or why they can't
// apply yet. The form posts intent "enter" to the page's own action.

export const ENTERED_NOTICE = "Neveztetek. A szervező döntését a Párom oldalon látjátok.";

const BLOCKED_LINKS: Partial<Record<Extract<EntryView, { kind: "blocked" }>["reason"], { to: string; label: string }>> = {
  no_pair: { to: "/pair", label: "Párom" },
  no_level: { to: "/profile#adatok", label: "Megadom a szintem" },
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
          A szezon már elindult, de még nevezhettek: ha a szervező jóváhagyja, a következő körtől játszotok.
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

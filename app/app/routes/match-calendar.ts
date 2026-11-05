import { data } from "react-router";

import type { Route } from "./+types/match-calendar";
import { getActor } from "~/lib/auth/admin.server";
import { can } from "~/lib/auth/permissions";
import { requireUser } from "~/lib/auth/session.server";
import { icsFileName, toIcs } from "~/lib/calendar";
import { matchCalendarEvent } from "~/lib/matches.server";

// The .ics of a match's agreed time (#192, D106): for its four players and
// the league's organizers. The same UID each time and a growing SEQUENCE, so
// a new download replaces the old entry; a cancelled time is STATUS:CANCELLED.
// Anyone else, or a match without a time, gets 404.
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const id = Number(params.id);
  const actor = await getActor(request);
  const event =
    Number.isInteger(id) && id > 0
      ? await matchCalendarEvent(id, { userId: user.id, manages: (league) => !!actor && can(actor, { kind: "league.manage", league }) })
      : null;
  if (!event) throw data("Nincs ilyen meccs.", { status: 404 });
  return new Response(toIcs(event), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${icsFileName(event.matchId)}"`,
      "Cache-Control": "private, no-store",
    },
  });
}

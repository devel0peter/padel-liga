import { data } from "react-router";

import type { Route } from "./+types/admin.league-match";
import { AppPage } from "~/components/app-page";
import { Contacts, StatusPill } from "~/components/my-group";
import { Badge } from "~/components/ui/badge";
import { requirePermission } from "~/lib/auth/admin.server";
import { formatDateTime, formatDeadline } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { STUCK_TEXT } from "~/lib/match-overview";
import { organizerMatch } from "~/lib/match-overview.server";
import { getLeague } from "~/lib/leagues.server";
import { groupLine } from "~/lib/matches";
import { SITE_NAME } from "~/lib/site";

// One match for the league's Szervező and the Admin (#158, D76): status,
// who has been active, both pairs' phone numbers while the phase runs (so
// the organizer can call), and the full log. Read only; deciding and
// overriding come with #29.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Meccs – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

const NOT_FOUND = "Nincs ilyen meccs.";

export async function loader({ request, params }: Route.LoaderArgs) {
  const league = await getLeague(params.league);
  if (!league) throw data("Nincs ilyen liga.", { status: 404 });
  await requirePermission(request, { kind: "league.manage", league: league.slug });
  const id = Number(params.id);
  // Another league's match can't be reached through this league's URL.
  const match = Number.isInteger(id) && id > 0 ? await organizerMatch(league.id, id) : null;
  if (!match) throw data(NOT_FOUND, { status: 404 });
  return { league: { slug: league.slug }, match };
}

export default function LeagueMatch({ loaderData }: Route.ComponentProps) {
  const { league, match: m } = loaderData;
  return (
    <AppPage
      title={`${groupLine(m.groupNumber, m.groupCount)}, ${m.week}. hét`}
      description={`${m.season}, ${m.phase}. kör · ${weekRange(m.phaseStartsAt, m.week)} · határidő: ${formatDeadline(m.deadline)}`}
      back={{ to: `/admin/leagues/${league.slug}/matches`, label: "Meccsek" }}
    >
      <section className="grid max-w-2xl gap-2 rounded-lg border p-4 sm:p-6" aria-label="Állapot">
        <div className="flex flex-wrap gap-1.5">
          <StatusPill label={m.label} tone={m.tone} />
          {m.stuck && <Badge variant="destructive">{STUCK_TEXT[m.stuck]}</Badge>}
        </div>
        <p className="text-sm">{m.activity}</p>
      </section>

      <section className="grid max-w-2xl gap-3 sm:grid-cols-2" aria-label="Párok">
        {m.pairs.map((p) => (
          <div key={p.side} className="grid content-start gap-2 rounded-lg border p-4">
            <p className="font-medium break-words">{p.name}</p>
            <div>
              <Badge variant={p.active ? "secondary" : "outline"}>{p.active ? "Lépett" : "Még nem lépett"}</Badge>
            </div>
            {m.running && <Contacts contacts={p.players.map((x) => ({ name: x.name, phone: x.phone ?? "" }))} />}
          </div>
        ))}
        {!m.running && <p className="text-sm text-muted-foreground sm:col-span-2">A kör lezárult, a telefonszámok már nem látszanak.</p>}
      </section>

      <section className="grid max-w-2xl gap-2" aria-labelledby="naplo">
        <h2 id="naplo" className="font-display text-lg font-bold">
          Napló
        </h2>
        {m.log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Még nem történt semmi.</p>
        ) : (
          <ol className="grid gap-2 text-sm">
            {m.log.map((e) => (
              <li key={e.id} className="grid gap-0.5 rounded-md border p-3">
                <span className="text-xs break-words text-muted-foreground">
                  {formatDateTime(e.at)} · {e.who} ({e.pair})
                </span>
                <span className="break-words">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </AppPage>
  );
}

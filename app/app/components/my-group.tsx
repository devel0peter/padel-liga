import { ChevronRight, Mail, Phone } from "lucide-react";
import { Link } from "react-router";

import { autoAcceptAt } from "@padel-liga/rules";

import { FixtureList } from "~/components/fixture-list";
import { GroupMessage } from "~/components/group-message";
import { StandingsTable } from "~/components/standings-table";
import { Button } from "~/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDeadline } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { formatSlot, groupLine, statusView, telHref, todoFor, venueLine, type Tone } from "~/lib/matches";
import type { HomeGroup, HomeMatch } from "~/lib/matches.server";
import { pairPath } from "~/lib/profiles";
import { resultStatusView, resultTodo } from "~/lib/results";
import { cn } from "~/lib/utils";

// Kezdőlap once the groups are out (#25, D133, D136, D140): Teendők (only
// when there is one), Következő meccsetek (the next match with the opponents'
// contacts, only while there is one) and the group: its table and, under it,
// every match of the group with its result, the pair's own rows a link.

const TONE: Record<Tone, string> = {
  todo: "bg-nav-active-bg text-nav-active",
  waiting: "bg-muted text-muted-foreground",
  done: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-block rounded-md px-2 py-1 text-xs font-semibold", TONE[tone])}>{label}</span>;
}

// The state as one line of text: the colour says whose move it is.
const LINE: Record<Tone, string> = {
  todo: "font-semibold text-nav-active",
  waiting: "text-muted-foreground",
  done: "text-muted-foreground",
};

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

export type Todo = { matchId: number; text: string; due: string | null };

export function todos(groups: readonly HomeGroup[]): Todo[] {
  return groups.flatMap((g) =>
    g.matches.flatMap((m) => {
      // Once a result exists, only its confirmation can be a Teendő (#28).
      if (m.result.status !== "none") {
        const text = resultTodo(m.result, m.side, m.opponents);
        const auto = autoAcceptAt(m.result);
        return text ? [{ matchId: m.id, text, due: auto ? `${formatDeadline(auto)} után magától elfogadjuk` : null }] : [];
      }
      const text = todoFor(m.state, m.side, m.opponents);
      return text ? [{ matchId: m.id, text, due: `határidő: ${formatDeadline(g.deadline)}` }] : [];
    }),
  );
}

// Teendők (spec 13, docs/player-ui.md H1): every open item, each a link to it,
// with its deadline. The page leaves it out when there is none. A light tint,
// a stronger edge and the count set it apart from the other cards (D143).
export function Todos({ items }: { items: Todo[] }) {
  return (
    <Card role="region" aria-labelledby="teendok" className="bg-nav-active-bg/40 ring-2 ring-nav-active/50">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} id="teendok" className="flex items-center gap-2 font-display text-lg font-bold">
          Teendők
          <span className="rounded-full bg-nav-active px-2 py-px text-xs font-bold text-white tabular-nums dark:text-background">
            {items.length}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid divide-y">
          {items.map((t) => (
            <li key={`${t.matchId}:${t.text}`}>
              <Link to={`/matches/${t.matchId}`} className="flex min-h-12 items-center gap-2 py-2 no-underline hover:text-nav-active">
                <span className="grid min-w-0 flex-1">
                  <span className="font-semibold break-words">{t.text}</span>
                  {t.due && <span className="text-xs text-muted-foreground">{t.due}</span>}
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-nav-active" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

// The match to look at now: the first one whose result isn't final yet.
const nextMatch = (g: HomeGroup) => [...g.matches].sort((x, y) => x.week - y.week).find((m) => m.result.status !== "final") ?? null;

function statusOf(m: HomeMatch) {
  return resultStatusView(m.result, m.side) ?? statusView(m.state, m.side, m.venue);
}

// When and where, once a time is fixed or agreed.
function whenWhere(m: HomeMatch): string | null {
  if (m.result.status !== "none") return null;
  if (m.state.status === "scheduled") return [formatSlot(m.state.slot), venueLine(m.venue, m.state.court)].filter(Boolean).join(" · ");
  return null;
}

// Következő meccsetek (docs/player-ui.md H2, D140): the first match whose
// result isn't final yet: opponents, its state, when and where once fixed,
// the opponents' contacts, Írj mindenkinek (D147) and the way in. Nothing once every match is final;
// the group's fixture list under the table has them all.
// `origin`: the site's, for the match link in the Írj mindenkinek text (D147).
export function NextMatch({ group: g, multiLeague, origin }: { group: HomeGroup; multiLeague: boolean; origin: string }) {
  const m = nextMatch(g);
  if (!m) return null;
  const status = statusOf(m);
  const fixed = whenWhere(m);
  const current = g.fixtures.find((w) => w.current)?.week === m.week;
  return (
    <Card role="region" aria-labelledby={`kovetkezo-${g.groupId}`}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} id={`kovetkezo-${g.groupId}`} className="font-display text-lg font-bold">
          Következő meccsetek{multiLeague ? ` · ${g.league}` : ""}
        </CardTitle>
        <CardDescription>
          {m.week}. hét · {weekRange(g.phaseStartsAt, m.week)}
          {current && <span className="font-semibold text-court"> · ez a hét</span>}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-0.5">
          <p className="font-semibold break-words">{m.opponents} ellen</p>
          <p className={cn("text-sm", LINE[status.tone])}>{status.label}</p>
          {fixed && <p className="text-sm font-medium">{fixed}</p>}
        </div>
        <Contacts contacts={m.contacts} />
        <GroupMessage message={m.message} week={m.week} url={`${origin}/matches/${m.id}`} />
        <Button asChild size="sm" className="w-fit">
          <Link to={`/matches/${m.id}`} className="no-underline">
            A meccs oldala
            <ChevronRight aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The group (docs/player-ui.md H3): its table, where the pair stands on the
// ladder and the group's matches with their results (D138); the pair's own
// rows are marked and open their match page (D140).
export function GroupStanding({ group: g, multiLeague }: { group: HomeGroup; multiLeague: boolean }) {
  const title = groupLine(g.number, g.groupCount);
  return (
    <Card role="region" aria-label={title}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} className="font-display text-lg font-bold">{title}</CardTitle>
        <CardDescription>
          {multiLeague ? `${g.league}, ` : ""}
          {g.season}, {g.phase}. kör. {capitalize(g.standing)}.
        </CardDescription>
        <CardAction>
          <Button asChild variant="outline" size="sm">
            <Link to={`/league/${g.leagueSlug}`} className="no-underline">
              Tabella
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2">
        <StandingsTable rows={g.pairs} ranked={g.ranked} linkFor={pairPath} />
        {g.withdrawn.length > 0 && <p className="text-sm text-muted-foreground">Visszalépett: {g.withdrawn.join(", ")}. A meccseik nem számítanak.</p>}
        <h3 className="mt-2 font-semibold">A csoport meccsei</h3>
        <FixtureList weeks={g.fixtures} label="A csoport meccsei" />
      </CardContent>
    </Card>
  );
}

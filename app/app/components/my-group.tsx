import { ChevronRight, Mail, Phone } from "lucide-react";
import { Link } from "react-router";

import { autoAcceptAt } from "@padel-liga/rules";

import { FixtureList } from "~/components/fixture-list";
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

// Kezdőlap once the groups are out (#25, D133, D136): three separate cards,
// Teendők (only when there is one), Meccseitek (a row per week, the next match
// open) and the group: its table and, under it, every match of the group with
// its result, to read only (D138).

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
// with its deadline. The page leaves it out when there is none.
export function Todos({ items }: { items: Todo[] }) {
  return (
    <Card role="region" aria-labelledby="teendok" className="ring-nav-active/40">
      <CardHeader>
        <CardTitle role="heading" aria-level={2} id="teendok" className="font-display text-lg font-bold">
          Teendők
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

function WeekRow({ g, week, current, open }: { g: HomeGroup; week: number; current: boolean; open: boolean }) {
  const m = g.matches.find((x) => x.week === week) ?? null;
  const off = g.offWeeks.find((o) => o.week === week) ?? null;
  const head = (
    <p className="text-xs text-muted-foreground">
      <span className="font-semibold text-foreground">{week}. hét</span> · {weekRange(g.phaseStartsAt, week)}
      {current && <span className="font-semibold text-court"> · ez a hét</span>}
    </p>
  );
  if (!m)
    return (
      <li className="grid gap-0.5 py-3">
        {head}
        <p className="text-sm text-muted-foreground">
          {off ? `${off.opponents} visszalépett a körből: ez a meccs elmarad, és nem számít a tabellában.` : "Pihenőhét: ezen a héten nem játszotok."}
        </p>
      </li>
    );
  const status = statusOf(m);
  const body = (
    <div className="grid min-w-0 flex-1 gap-0.5">
      {head}
      <p className="font-semibold break-words">{m.opponents}</p>
      <p className={cn("text-sm", LINE[status.tone])}>{status.label}</p>
    </div>
  );
  if (!open)
    return (
      <li>
        <Link to={`/matches/${m.id}`} className="-mx-2 flex items-center gap-2 rounded-lg px-2 py-3 text-foreground no-underline hover:bg-muted/50 sm:-mx-3 sm:px-3">
          {body}
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        </Link>
      </li>
    );
  // The next match: when and where, the opponents' contacts, and the way in.
  const fixed = whenWhere(m);
  return (
    <li className="-mx-2 my-1 grid gap-3 rounded-lg bg-muted/60 p-2 sm:-mx-3 sm:p-3">
      {body}
      {fixed && <p className="text-sm font-medium">{fixed}</p>}
      <Contacts contacts={m.contacts} />
      <Button asChild size="sm" className="w-fit">
        <Link to={`/matches/${m.id}`} className="no-underline">
          A meccs oldala
          <ChevronRight aria-hidden />
        </Link>
      </Button>
    </li>
  );
}

// Meccseitek (docs/player-ui.md H2): a row per week, the next match open.
export function MyMatches({ group: g, multiLeague }: { group: HomeGroup; multiLeague: boolean }) {
  const current = g.fixtures.find((w) => w.current)?.week ?? null;
  const next = nextMatch(g);
  return (
    <Card role="region" aria-labelledby={`meccseitek-${g.groupId}`}>
      <CardHeader>
        <CardTitle role="heading" aria-level={2} id={`meccseitek-${g.groupId}`} className="font-display text-lg font-bold">
          Meccseitek{multiLeague ? ` · ${g.league}` : ""}
        </CardTitle>
        <CardDescription>
          {g.phase}. kör · határidő: {formatDeadline(g.deadline)}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid divide-y" aria-label="Meccseitek">
          {[1, 2, 3].map((week) => (
            <WeekRow key={week} g={g} week={week} current={week === current} open={next?.week === week} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The fixture list without the links into the pair's own matches.
const readOnly = (weeks: HomeGroup["fixtures"]): HomeGroup["fixtures"] =>
  weeks.map((w) => ({ ...w, matches: w.matches.map((m) => ({ ...m, href: null })) }));

// The group (docs/player-ui.md H3): its table, where the pair stands on the
// ladder and the group's matches with their results (D138). Read only: no
// links into the matches here, Meccseitek has the pair's own.
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
        <FixtureList weeks={readOnly(g.fixtures)} label="A csoport meccsei" />
      </CardContent>
    </Card>
  );
}

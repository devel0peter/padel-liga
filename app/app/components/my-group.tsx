import { ChevronRight, Phone } from "lucide-react";
import { Link } from "react-router";

import { autoAcceptAt } from "@padel-liga/rules";

import { FixtureList } from "~/components/fixture-list";
import { StandingsTable } from "~/components/standings-table";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { formatDeadline } from "~/lib/format";
import { weekRange } from "~/lib/groups";
import { groupLine, statusView, telHref, todoFor, type Tone } from "~/lib/matches";
import type { HomeGroup, HomeMatch, Opponent } from "~/lib/matches.server";
import { pairPath } from "~/lib/profiles";
import { resultStatusView, resultTodo } from "~/lib/results";
import { cn } from "~/lib/utils";

// Kezdőlap once the groups are out (#25, D133): the Teendők, the pair's
// matches as cards, and the group's table and fixture list. Mobile first:
// nothing scrolls sideways at 390 px; wide screens put the two side by side.

const TONE: Record<Tone, string> = {
  todo: "bg-nav-active-bg text-nav-active",
  waiting: "bg-muted text-muted-foreground",
  done: "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
};

export function StatusPill({ label, tone }: { label: string; tone: Tone }) {
  return <span className={cn("inline-block rounded-md px-2 py-1 text-xs font-semibold", TONE[tone])}>{label}</span>;
}

// The other pair's phone numbers, tap to call (#25 requirement 4): one round
// button per player, big enough for a thumb. Never an email address.
export function Contacts({ contacts, className }: { contacts: Opponent[]; className?: string }) {
  if (contacts.length === 0) return null;
  return (
    <ul className={cn("flex flex-wrap gap-2 text-sm", className)} aria-label="Telefonszámok">
      {contacts.map((c) => (
        <li key={c.name} className="min-w-0">
          {c.phone ? (
            <a
              href={telHref(c.phone)}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 no-underline hover:bg-accent"
            >
              <Phone className="size-3.5 shrink-0 text-court" />
              <span className="break-words">
                <span className="font-medium">{c.name}:</span> {c.phone}
              </span>
            </a>
          ) : (
            <span className="inline-flex min-h-10 items-center text-muted-foreground">{c.name}: nincs telefonszám</span>
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
        return text
          ? [
              {
                matchId: m.id,
                text,
                due: auto ? `${formatDeadline(auto)} után magától elfogadjuk` : null,
              },
            ]
          : [];
      }
      const text = todoFor(m.state, m.side, m.opponents);
      return text
        ? [
            {
              matchId: m.id,
              text,
              due: `határidő: ${formatDeadline(g.deadline)}`,
            },
          ]
        : [];
    }),
  );
}

// Teendők (#25 requirement 3, spec 13): every open item, each a link to it,
// with its deadline (docs/player-ui.md H1).
export function Todos({ items }: { items: Todo[] }) {
  return (
    <section aria-labelledby="teendok" className="grid gap-2 rounded-xl border border-nav-active/50 bg-nav-active-bg p-4 sm:p-5">
      <h2 id="teendok" className="font-display text-lg font-bold">
        Teendők
      </h2>
      {items.length === 0 ? (
        <p className="text-muted-foreground">Most nincs teendőd.</p>
      ) : (
        <ul className="grid gap-2">
          {items.map((t) => (
            <li key={`${t.matchId}:${t.text}`}>
              <Link
                to={`/matches/${t.matchId}`}
                className="flex items-center gap-2 rounded-lg bg-background px-3 py-2 no-underline shadow-xs ring-1 ring-nav-active/20 hover:ring-nav-active"
              >
                <span className="grid min-w-0 flex-1">
                  <span className="font-semibold break-words">{t.text}</span>
                  {t.due && <span className="text-xs text-muted-foreground">{t.due}</span>}
                </span>
                <ChevronRight className="size-4 shrink-0 text-nav-active" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Week = {
  week: number;
  match: HomeMatch | null;
  off: { opponents: string } | null;
};

// One of the pair's matches (docs/player-ui.md H2): the whole card opens the
// match; the call buttons sit above that link.
function MatchCard({ g, week, match: m, off, current }: Week & { g: HomeGroup; current: boolean }) {
  const status = m ? (resultStatusView(m.result, m.side) ?? statusView(m.state, m.side, m.venue)) : null;
  return (
    <li
      className={cn(
        "relative grid gap-2 rounded-xl border bg-card p-3 sm:p-4",
        status?.tone === "todo" && "border-nav-active ring-1 ring-nav-active/30",
        m && "transition-colors hover:bg-accent/40",
      )}
    >
      <p className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
        {week}. hét · {weekRange(g.phaseStartsAt, week)}
        {current && <span className="rounded-full bg-court px-2 py-px text-[10px] font-bold tracking-wide text-white uppercase">ez a hét</span>}
      </p>
      {m ? (
        <>
          <p className="font-display text-base font-bold break-words">{m.opponents} ellen</p>
          <div>
            <StatusPill {...status!} />
          </div>
          {m.result.status !== "final" && <Contacts contacts={m.contacts} className="relative z-10" />}
          <Link
            to={`/matches/${m.id}`}
            className="inline-flex w-fit items-center gap-1 text-sm font-semibold text-nav-active no-underline after:absolute after:inset-0 after:rounded-xl"
          >
            Egyeztetés és részletek
            <ChevronRight className="size-4" />
          </Link>
        </>
      ) : off ? (
        <p className="text-muted-foreground">{off.opponents} visszalépett a körből: ez a meccs elmarad, és nem számít a tabellában.</p>
      ) : (
        <p className="text-muted-foreground">Pihenőhét: ezen a héten nem játszotok.</p>
      )}
    </li>
  );
}

export function MyGroup({ group: g, multiLeague }: { group: HomeGroup; multiLeague: boolean }) {
  const current = g.fixtures.find((w) => w.current)?.week ?? null;
  const weeks: Week[] = [1, 2, 3].map((week) => ({
    week,
    match: g.matches.find((m) => m.week === week) ?? null,
    off: g.offWeeks.find((o) => o.week === week) ?? null,
  }));
  const title = groupLine(g.number, g.groupCount);
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] xl:items-start">
      <section aria-labelledby={`meccseitek-${g.groupId}`} className="grid gap-3">
        <h2 id={`meccseitek-${g.groupId}`} className="font-display text-lg font-bold">
          Meccseitek{multiLeague ? ` · ${g.league}` : ""}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1" aria-label="Meccseitek">
          {weeks.map((w) => (
            <MatchCard key={w.week} {...w} g={g} current={w.week === current} />
          ))}
        </ul>
      </section>
      <Card aria-label={title} className="gap-4">
        <CardHeader className="gap-1.5">
          <CardTitle className="font-display text-lg">{title}</CardTitle>
          <CardDescription className="grid gap-1">
            <span>
              {multiLeague ? `${g.league}, ` : ""}
              {g.season}, {g.phase}. kör · határidő: {formatDeadline(g.deadline)}
            </span>
            <span className="font-medium text-foreground">{capitalize(g.standing)}.</span>
          </CardDescription>
          <CardAction>
            <Link
              to={`/league/${g.leagueSlug}`}
              className="inline-flex items-center gap-1 text-sm font-semibold whitespace-nowrap text-nav-active no-underline"
            >
              Minden csoport
              <ChevronRight className="size-4" />
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-6">
          <StandingsTable rows={g.pairs} ranked={g.ranked} linkFor={pairPath} />
          {g.withdrawn.length > 0 && <p className="text-sm text-muted-foreground">Visszalépett: {g.withdrawn.join(", ")}. A meccseik nem számítanak.</p>}
          <div className="grid gap-2">
            <h3 className="font-display text-base font-bold">A csoport meccsei</h3>
            <FixtureList weeks={g.fixtures} label="A csoport meccsei" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

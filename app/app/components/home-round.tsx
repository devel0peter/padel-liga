import { Check, ChevronRight, CircleAlert } from "lucide-react";
import { Link, useFetcher } from "react-router";

import { ActionCard, BigRank, IconTile, ListCard, MatchRow, RoundProgress, SectionLabel, StatusPill, TeamBadge } from "~/components/blocks";
import { Button } from "~/components/ui/button";
import { formatClockTime, formatShortDate } from "~/lib/format";
import { withArticle } from "~/lib/groups";
import { doneText, homeTodos, matchPill, matchScore, matchWhen, roundClock, type HomeTodo, type NextRound } from "~/lib/home";
import type { HomeGroup, HomeMatch, TeamBadgeData } from "~/lib/matches.server";
import { pairPath } from "~/lib/profiles";
import { cn } from "~/lib/utils";

// Kezdőlap once the groups are out, in direction A (#420, mockup P01): the
// round's progress, "Rád vár" with the result to confirm answered in place,
// the group's standing and the player's matches of the round. The whole
// group's matches and the opponents' contacts are on the Tabella and the
// match page.

/** The round's card: round, week, days left, deadline, and how many of the pair's matches are done. */
export function HomeRound({ group: g, now }: { group: HomeGroup; now: Date }) {
  const { daysLeft, progress } = roundClock(g.phaseStartsAt, g.deadline, now);
  return (
    <RoundProgress
      round={g.phase}
      week={g.week}
      deadline={`${formatShortDate(g.deadline)}, ${formatClockTime(g.deadline)}`}
      daysLeft={daysLeft}
      progress={progress}
      note={doneText(g.matches)}
    />
  );
}

const badge = (b: TeamBadgeData | null) => (b ? <TeamBadge pairId={b.pairId} initials={b.initials} size={40} /> : undefined);

type ConfirmAnswer = { ok: boolean; message: string };

// The opponents' result, confirmed on the card: the match page's own action
// (intent "result-confirm"), so the step and its checks are the same.
// "Nem így volt" leads to the match page, where the other score is typed.
function ConfirmCard({ todo, match }: { todo: HomeTodo; match: HomeMatch }) {
  const fetcher = useFetcher<ConfirmAnswer>();
  const busy = fetcher.state !== "idle";
  const to = `/matches/${todo.matchId}`;
  return (
    <ActionCard
      urgent
      leading={badge(match.badge)}
      title={
        <Link to={to} className="text-inherit no-underline hover:underline">
          {todo.title}
        </Link>
      }
      description={
        <>
          {todo.description} <strong className="font-bold text-foreground">{todo.score}</strong>
        </>
      }
      note={
        fetcher.data && !fetcher.data.ok ? (
          <span role="alert" className="font-semibold text-danger">
            {fetcher.data.message}
          </span>
        ) : (
          todo.note
        )
      }
      actions={
        <>
          <fetcher.Form method="post" action={to} className="flex">
            <input type="hidden" name="intent" value="result-confirm" />
            <Button type="submit" size="xl" disabled={busy} className="flex-1">
              Megerősítem
            </Button>
          </fetcher.Form>
          <Button asChild size="xl" variant="secondary">
            <Link to={`${to}#eredmeny`} className="no-underline">
              Nem így volt
            </Link>
          </Button>
        </>
      }
    />
  );
}

/** "Rád vár · N": one card per step that waits on the player; nothing when there is none. */
export function HomeTodos({ groups }: { groups: readonly HomeGroup[] }) {
  const matches = groups.flatMap((g) => g.matches);
  const items = homeTodos(matches);
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="rad-var" className="flex flex-col gap-3">
      <SectionLabel id="rad-var" tone="warning">
        Rád vár · {items.length}
      </SectionLabel>
      {items.map((t) => {
        const match = matches.find((m) => m.id === t.matchId)!;
        return t.kind === "confirm" ? (
          <ConfirmCard key={t.matchId} todo={t} match={match} />
        ) : (
          <ActionCard
            key={t.matchId}
            to={`/matches/${t.matchId}`}
            linkLabel="Megnézem"
            leading={badge(match.badge)}
            title={t.title}
            description={t.description}
            note={t.note}
          />
        );
      })}
    </section>
  );
}

const ZONE_TEXT = { up: "feljutó hely", down: "kieső hely" } as const;

/**
 * The group's standing: the pair's place as a big number, the points, and
 * the table in short (place, team, sets, points). Before any final result
 * the order is only the seeding (D85), so no places show.
 */
export function HomeStanding({ group: g, multiLeague }: { group: HomeGroup; multiLeague: boolean }) {
  const mine = g.pairs.find((p) => p.mine);
  const where = `${g.division} divízió · ${g.number}. csoport`;
  return (
    <section aria-label={where} className="flex flex-col gap-4 rounded-2xl bg-surface p-4 md:p-5">
      {multiLeague && <p className="m-0 text-caption text-muted-foreground">{g.league}</p>}
      {g.ranked && mine ? (
        <div className="flex items-end justify-between gap-3">
          <BigRank
            place={mine.rank}
            caption={
              <>
                hely<span className="hidden md:inline">, {mine.points} ponttal</span>
              </>
            }
            detail={where}
          />
          <StatusPill tone="neutral" className="mb-1 md:hidden">
            {mine.points} pont
          </StatusPill>
        </div>
      ) : (
        <div className="flex flex-col gap-0.5">
          <h2 className="m-0 text-lg leading-snug font-bold">{where}</h2>
          <p className="m-0 text-caption text-muted-foreground">Még nincs végleges eredmény: a sorrend a kiemelés.</p>
        </div>
      )}
      <table aria-label="Tabella" className="w-full border-separate border-spacing-y-0.5 text-body">
        <thead className="sr-only">
          <tr>
            <th scope="col">Hely</th>
            <th scope="col">Pár</th>
            <th scope="col">Szett</th>
            <th scope="col">Pont</th>
          </tr>
        </thead>
        <tbody>
          {g.pairs.map((p) => (
            <tr key={p.pairId} className={cn("[&>td]:h-10 [&>td]:py-1", p.mine && "font-bold [&>td]:bg-ball-tint")}>
              <td className={cn("w-8 rounded-l-[10px] pl-2.5 tabular-nums", p.mine ? "text-ball" : p.zone === "down" ? "text-danger" : "text-muted-foreground")}>
                {g.ranked ? p.rank : ""}
              </td>
              <td>
                <span className="flex min-w-0 items-center gap-2.5">
                  <TeamBadge pairId={p.pairId} initials={["", ""]} size={20} />
                  <span className="min-w-0">
                    <Link to={pairPath(p.pairId)} className="break-words text-inherit no-underline hover:underline">
                      {p.label}
                    </Link>
                    {p.mine && <span className="sr-only"> (ti)</span>}
                    {p.zone && <span className={cn("text-xs font-normal", p.zone === "down" ? "text-danger" : "text-success")}> · {ZONE_TEXT[p.zone]}</span>}
                  </span>
                </span>
              </td>
              <td className="hidden w-12 text-right font-normal text-muted-foreground tabular-nums md:table-cell">
                {p.setsWon}:{p.setsLost}
              </td>
              <td className="w-10 rounded-r-[10px] pr-3 text-right tabular-nums">{p.points}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {g.withdrawn.length > 0 && (
        <p className="m-0 text-caption text-muted-foreground">Visszalépett: {g.withdrawn.join(", ")}. A meccseik nem számítanak.</p>
      )}
      <Link
        to={`/league/${g.leagueSlug}`}
        className="flex min-h-11 w-fit items-center gap-1 text-sm font-bold text-ball no-underline hover:underline"
      >
        Teljes tabella
        <ChevronRight aria-hidden className="size-[18px]" />
      </Link>
    </section>
  );
}

/** "Meccseid az N. körben": the pair's matches of the round, each coloured by its state, a link to its page. */
export function HomeMatches({ group: g, multiLeague }: { group: HomeGroup; multiLeague: boolean }) {
  if (g.matches.length === 0) return null;
  const id = `meccseid-${g.groupId}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <SectionLabel id={id}>
        Meccseid {withArticle(g.phase)} körben{multiLeague ? ` · ${g.league}` : ""}
      </SectionLabel>
      <ListCard>
        {[...g.matches]
          .sort((x, y) => x.week - y.week)
          .map((m) => (
            <MatchRow
              key={m.id}
              to={`/matches/${m.id}`}
              status={matchPill(m)}
              week={`${m.week}. hét`}
              opponent={m.opponents}
              score={matchScore(m) ?? undefined}
              when={matchWhen(m, g.phaseStartsAt)}
            />
          ))}
      </ListCard>
    </section>
  );
}

/** Whether the pair plays on in the next round (#395), as on Ligáim, where it can be changed. */
export function HomeNextRound({ next }: { next: NextRound }) {
  return (
    <ActionCard
      to={next.to}
      leading={<IconTile tone={next.tone}>{next.tone === "success" ? <Check /> : <CircleAlert />}</IconTile>}
      title={<span className="text-body">{next.title}</span>}
      description={next.detail}
    />
  );
}

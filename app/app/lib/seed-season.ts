// A running phase 1 on top of the walkthrough seed (seed.ts), for trying the
// match pages locally: every pair and paired solo signup has a finished
// account, 11 approved pairs sit in 3 published groups (4, 4, 3), and today
// falls in week 2 of phase 1, with matches in every state (final, waiting for
// confirmation, disputed, proposed, counter-proposed, agreed time, booked,
// played without a result, open). Pure (no I/O): scripts/seed-season-local.ts
// runs it against the local D1 only, after the same guard as seed.ts.

import {
  addDays,
  budapestDay,
  budapestTime,
  groupRounds,
  isMonday,
  phaseCalendar,
  type MatchOutcome,
  type MatchScore,
  type Side,
} from "@padel-liga/rules";

import { LEAGUE, ORGANIZER, PAIR_SIGNUPS, SEASON_NAME, SOLO_SIGNUPS, seedSql } from "./seed";

type Level = "kezdo" | "kozephalado" | "halado" | "versenyzo";
type Person = { name: string; email: string };
export type SeasonPair = { a: Person; b: Person; level: Level };

export type SeedEventKind =
  | "proposal"
  | "counter_proposal"
  | "accepted"
  | "agreed_time"
  | "agreed_confirmed"
  | "venue"
  | "result_recorded"
  | "result_confirmed"
  | "result_disputed";

export type SeedEvent = {
  kind: SeedEventKind;
  side: Side;
  at: Date;
  slots?: Date[];
  slot?: Date;
  club?: string;
  court?: string;
  score?: MatchScore;
  note?: string;
};

export type SeedMatch = {
  /** Indexes into `pairs`, as pair_a and pair_b of the fixture. */
  a: number;
  b: number;
  events: SeedEvent[];
  status: "open" | "scheduled" | "result_pending" | "disputed" | "final";
  scheduledAt?: Date;
  club?: string;
  outcome?: MatchOutcome;
};

export type SeasonPlan = {
  start: string;
  phases: ReturnType<typeof phaseCalendar>;
  pairs: SeasonPair[];
  /** Pair indexes per group, strongest first (the seed order). */
  groups: number[][];
  /** Every fixture of every group: [group index, week, pair a, pair b]. */
  fixtures: [number, number, number, number][];
  /** The fixtures that have a log; the rest stay open with none. */
  matches: SeedMatch[];
};

// 11 pairs, strongest first: the ten pair signups with the two paired solos
// among the kozephalado pairs.
export function seasonPairs(): SeasonPair[] {
  const [v, k] = [SOLO_SIGNUPS[0]!, SOLO_SIGNUPS[1]!];
  return [...PAIR_SIGNUPS.slice(0, 7), { a: v.who, b: k.who, level: v.level }, ...PAIR_SIGNUPS.slice(7)];
}

export const SEASON_GROUPS = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [8, 9, 10],
];

// Phase 1 starts on the Monday on or before a week ago, so today is in week 2.
export function runningStart(now: Date): string {
  let day = addDays(budapestDay(now), -7);
  while (!isMonday(day)) day = addDays(day, -1);
  return day;
}

export function seasonPlan(now: Date): SeasonPlan {
  const start = runningStart(now);
  const today = budapestDay(now);
  const at = (day: string, h: number, m = 0) => budapestTime(day, h, m);
  const ago = (hours: number) => new Date(now.getTime() - hours * 3600_000);
  const later = (d: Date, hours: number) => new Date(d.getTime() + hours * 3600_000);
  const D = (n: number) => addDays(start, n);
  const T = (n: number) => addDays(today, n);
  const otherSide = (s: Side): Side => (s === "a" ? "b" : "a");

  // A proposal and its acceptance: the first two steps of a booked match.
  const booked = (proposer: Side, slot: Date, club: string, proposedAt: Date): SeedEvent[] => [
    { kind: "proposal", side: proposer, at: proposedAt, slots: [slot, later(slot, 26), later(slot, 49)], club },
    { kind: "accepted", side: otherSide(proposer), at: later(proposedAt, 5), slot },
  ];
  const recorded = (score: MatchScore, by: Side, when: Date): SeedEvent => ({ kind: "result_recorded", side: by, at: when, score });
  const confirmed = (by: Side, when: Date): SeedEvent => ({ kind: "result_confirmed", side: otherSide(by), at: later(when, 10) });
  const final = (a: number, b: number, events: SeedEvent[], slot: Date, club: string, score: MatchScore): SeedMatch => ({
    a,
    b,
    events,
    status: "final",
    scheduledAt: slot,
    club,
    outcome: { kind: "played", score },
  });

  const matches: SeedMatch[] = [];

  // Group 1 (pairs 0-3). Kovács Anna (pair 0): one played, a result to
  // confirm, a proposal to answer.
  {
    const s1 = at(D(2), 19);
    const sc1: MatchScore = { sets: [[4, 2], [4, 1]] };
    matches.push(final(0, 3, [...booked("a", s1, "minta-padel-arena", at(D(0), 9)), recorded(sc1, "a", at(D(2), 21)), confirmed("a", at(D(2), 21))], s1, "minta-padel-arena", sc1));
    const s2 = at(D(4), 18, 30);
    const sc2: MatchScore = { sets: [[2, 4], [5, 3]], superTieBreak: [10, 8] };
    matches.push(
      final(
        1,
        2,
        [
          { kind: "agreed_time", side: "a", at: at(D(1), 12), slot: s2, club: "teszt-sportcentrum" },
          { kind: "agreed_confirmed", side: "b", at: at(D(1), 15) },
          recorded(sc2, "b", at(D(4), 21)),
          confirmed("b", at(D(4), 21)),
        ],
        s2,
        "teszt-sportcentrum",
        sc2,
      ),
    );
    const s3 = at(T(-1), 19);
    matches.push({
      a: 0,
      b: 2,
      events: [...booked("b", s3, "pelda-padel-club", at(T(-4), 10)), recorded({ sets: [[4, 5], [2, 4]] }, "b", ago(4))],
      status: "result_pending",
      scheduledAt: s3,
      club: "pelda-padel-club",
    });
    matches.push({
      a: 1,
      b: 3,
      events: [{ kind: "proposal", side: "a", at: ago(2), slots: [at(T(3), 18), at(T(4), 19), at(T(5), 8)], club: "minta-padel-arena" }],
      status: "open",
    });
    matches.push({
      a: 0,
      b: 1,
      events: [{ kind: "proposal", side: "b", at: ago(3), slots: [at(T(3), 19), at(T(4), 18, 30), at(T(5), 10)], club: "teszt-sportcentrum" }],
      status: "open",
    });
  }

  // Group 2 (pairs 4-7).
  {
    const s1 = at(D(3), 20);
    matches.push({
      a: 4,
      b: 7,
      events: [
        ...booked("b", s1, "minta-padel-arena", at(D(0), 11)),
        recorded({ sets: [[4, 2], [4, 1]] }, "a", at(D(3), 22)),
        {
          kind: "result_disputed",
          side: "b",
          at: at(D(4), 10),
          score: { sets: [[2, 4], [4, 1]], superTieBreak: [7, 10] },
          note: "Az első szettet mi nyertük 4:2-re, utána jött a szuperrövidítés.",
        },
      ],
      status: "disputed",
      scheduledAt: s1,
      club: "minta-padel-arena",
    });
    const s2 = at(D(5), 10);
    const sc2: MatchScore = { sets: [[5, 4], [4, 2]] };
    matches.push(final(5, 6, [...booked("a", s2, "pelda-padel-club", at(D(1), 8)), recorded(sc2, "b", at(D(5), 13)), confirmed("b", at(D(5), 13))], s2, "pelda-padel-club", sc2));
    const s3 = at(T(1), 18);
    matches.push({
      a: 4,
      b: 6,
      events: [...booked("a", s3, "minta-padel-arena", at(T(-3), 9)), { kind: "venue", side: "b", at: at(T(-2), 12), club: "minta-padel-arena", court: "2-es pálya" }],
      status: "scheduled",
      scheduledAt: s3,
      club: "minta-padel-arena",
    });
    matches.push({
      a: 5,
      b: 7,
      events: [{ kind: "agreed_time", side: "a", at: ago(2), slot: at(T(2), 19, 30), club: "pelda-padel-club" }],
      status: "open",
    });
    matches.push({
      a: 4,
      b: 5,
      events: [
        { kind: "proposal", side: "a", at: ago(30), slots: [at(T(2), 7), at(T(3), 7), at(T(4), 7)], club: "teszt-sportcentrum" },
        { kind: "counter_proposal", side: "b", at: ago(6), slots: [at(T(3), 19), at(T(4), 20), at(T(5), 18)], club: "teszt-sportcentrum" },
      ],
      status: "open",
    });
  }

  // Group 3 (pairs 8-10), a group of 3.
  {
    const s1 = at(D(5), 17);
    const sc1: MatchScore = { sets: [[1, 4], [3, 5]] };
    matches.push(final(9, 10, [...booked("b", s1, "teszt-sportcentrum", at(D(1), 18)), recorded(sc1, "a", at(D(5), 19)), confirmed("a", at(D(5), 19))], s1, "teszt-sportcentrum", sc1));
    const s2 = at(T(-1), 18);
    matches.push({ a: 8, b: 10, events: booked("a", s2, "pelda-padel-club", at(T(-5), 9)), status: "scheduled", scheduledAt: s2, club: "pelda-padel-club" });
  }

  const fixtures: [number, number, number, number][] = SEASON_GROUPS.flatMap((members, g) =>
    groupRounds(members).flatMap((round, w) => round.map(([a, b]) => [g, w + 1, a, b] as [number, number, number, number])),
  );
  return { start, phases: phaseCalendar(start, []), pairs: seasonPairs(), groups: SEASON_GROUPS, fixtures, matches };
}

// --- SQL ----------------------------------------------------------------------

const q = (s: string | null): string => (s === null ? "NULL" : `'${s.replaceAll("'", "''")}'`);
const secs = (d: Date): number => Math.floor(d.getTime() / 1000);
const json = (v: unknown): string => q(JSON.stringify(v));

export const seasonUserId = (p: Person): string => `seed-p-${p.email.split("@")[0]!.replace(/\W/g, "-")}`;

export function seasonStatements(now: Date): string[] {
  const plan = seasonPlan(now);
  const { start, phases, pairs } = plan;
  const SEASON = `(select s.id from seasons s join leagues l on l.id = s.league_id where l.slug = ${q(LEAGUE.slug)} and s.name = ${q(SEASON_NAME)})`;
  const CLUB = (slug: string | undefined) => (slug ? `(select id from clubs where slug = ${q(slug)})` : "NULL");
  const PAIR = (i: number) => `(select id from pairs where player_a = ${q(seasonUserId(pairs[i]!.a))} and status = 'active')`;
  const GROUP = (g: number) => `(select id from groups where season_id = ${SEASON} and phase = 1 and number = ${g + 1})`;
  const MATCH = (a: number, b: number) => `(select id from matches where pair_a = ${PAIR(a)} and pair_b = ${PAIR(b)})`;
  const joined = secs(new Date(now.getTime() - 20 * 24 * 3600_000));
  const published = secs(budapestTime(addDays(start, -2), 18, 0));
  const deadline = secs(phases[0]!.deadline);

  const out: string[] = [];
  // The season: registration closed the day before phase 1.
  out.push(
    `update seasons set registration_opens_at = ${secs(budapestTime(addDays(start, -30), 0, 0))}, ` +
      `registration_closes_at = ${secs(budapestTime(addDays(start, -1), 23, 59))}, first_phase_start = ${q(start)} where id = ${SEASON}`,
  );
  out.push(`delete from season_phases where season_id = ${SEASON}`);
  for (const p of phases)
    out.push(`insert into season_phases (season_id, number, starts_at, deadline) values (${SEASON}, ${p.number}, ${secs(p.startsAt)}, ${secs(p.deadline)})`);

  // Finished accounts with a fake phone each, then the pairs, approved for phase 1.
  let phone = 1000001;
  pairs.forEach((p) =>
    [p.a, p.b].forEach((who, j) =>
      out.push(
        `insert into users (id, email, name, level, sex, phone, consent_at, created_at) values (${q(seasonUserId(who))}, ${q(who.email)}, ` +
          `${q(who.name)}, ${q(p.level)}, ${q(j === 0 ? "female" : "male")}, ${q(`+3630${phone++}`)}, ${joined}, ${joined})`,
      ),
    ),
  );
  pairs.forEach((p, i) => {
    out.push(
      `insert into pairs (league_id, player_a, player_b, source, created_at) select id, ${q(seasonUserId(p.a))}, ${q(seasonUserId(p.b))}, ` +
        `'signup', ${joined} from leagues where slug = ${q(LEAGUE.slug)}`,
    );
    out.push(
      `insert into season_entries (season_id, pair_id, status, decided_by, decided_at, joins_phase, created_at) values ` +
        `(${SEASON}, ${PAIR(i)}, 'approved', ${q(ORGANIZER.id)}, ${joined}, 1, ${joined})`,
    );
  });

  // Published groups and their matches, as publishGroups writes them.
  plan.groups.forEach((members, g) => {
    out.push(`insert into groups (season_id, phase, number, published_at, created_at) values (${SEASON}, 1, ${g + 1}, ${published}, ${published})`);
    members.forEach((pi, seed) => out.push(`insert into group_pairs (group_id, pair_id, seed) values (${GROUP(g)}, ${PAIR(pi)}, ${seed + 1})`));
  });
  for (const [g, week, a, b] of plan.fixtures)
    out.push(
      `insert into matches (group_id, pair_a, pair_b, week, deadline, created_at) values (${GROUP(g)}, ${PAIR(a)}, ${PAIR(b)}, ${week}, ${deadline}, ${published})`,
    );

  // Each match's log, then its mirrored status, as matches.server.ts keeps it.
  for (const m of plan.matches) {
    for (const e of m.events) {
      const pair = e.side === "a" ? m.a : m.b;
      out.push(
        `insert into match_events (match_id, pair_id, user_id, kind, slots, slot, club_id, court, score, note, at) values (` +
          [
            MATCH(m.a, m.b),
            PAIR(pair),
            q(seasonUserId(pairs[pair]!.a)),
            q(e.kind),
            e.slots ? json(e.slots.map(secs)) : "NULL",
            e.slot ? secs(e.slot) : "NULL",
            CLUB(e.club),
            q(e.court ?? null),
            e.score ? json(e.score) : "NULL",
            q(e.note ?? null),
            secs(e.at),
          ].join(", ") +
          ")",
      );
    }
    out.push(
      `update matches set revision = ${m.events.length}, status = ${q(m.status)}, scheduled_at = ${m.scheduledAt ? secs(m.scheduledAt) : "NULL"}, ` +
        `club_id = ${CLUB(m.club)}, outcome = ${m.outcome ? json(m.outcome) : "NULL"} where id = ${MATCH(m.a, m.b)}`,
    );
  }
  return out;
}

// The walkthrough seed (reset included), then the running phase on top.
export function seasonSeedSql(now: Date): string {
  return seedSql(now) + seasonStatements(now).map((s) => `${s};`).join("\n") + "\n";
}

export function seasonSummary(now: Date): string {
  const plan = seasonPlan(now);
  const sizes = plan.groups.map((g) => g.length).join(", ");
  return [
    `Seeded a running phase 1 of "${SEASON_NAME}": started ${plan.start}, ${plan.pairs.length} pairs in groups of ${sizes}, ${plan.fixtures.length} matches.`,
    `Player: ${plan.pairs[0]!.a.email} (group 1, has a result to confirm and a proposal to answer)`,
    `Szervező: ${ORGANIZER.email} (Meccsek, Viták)`,
  ].join("\n");
}

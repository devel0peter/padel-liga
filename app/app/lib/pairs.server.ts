import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { rowSelect } from "~/db/insert-select";
import { groupPairs, groups, pairs, seasonEntries, seasonPhases, users } from "~/db/schema";
import { listedLeagues, memberOf, pairMemberStatements } from "~/lib/league-members.server";
import { notInRunningGroup, pairInRunningGroup } from "~/lib/groups.server";
import { auditEntry, auditIfChanged } from "~/lib/audit.server";
import { averageElo, homeEntry, organizerEntryAction, type EntryStatus, type OrganizerEntryAction } from "~/lib/season-entries";
import { queuePairCreated } from "~/lib/email/outbox.server";
import { partnerFoundMessage } from "~/lib/notifications";
import { notifyPlayers } from "~/lib/notifications.server";
import { pairPlayers, withdrawEntries } from "~/lib/season-entries.server";
import { homeSeasons } from "~/lib/seasons";
import { listSeasons } from "~/lib/seasons.server";

import type { User } from "./auth/session.server";
import { formatPhone } from "./phone";
import { canDissolve, checkNewPair, DISSOLVE_REFUSED, NEW_PAIR_REFUSALS, type PairSource } from "./pairs";

// Pairs in D1. The rules are in pairs.ts. Players only see their pair
// (/pair); a Szervező changes pairs on the Párok page (#97). No email goes
// out for a dissolve: the organizer tells the players.

export type PairLeague = { id: number; name: string };

type Result = { ok: true } | { ok: false; error: string };

// Where a pair can be made (a pair link works in): every league in a listed
// city (a city still being set up stays hidden). What a player sees on
// Kezdőlap and Párom is only their own leagues (playerLeagues, D128).
export async function pairLeagues(): Promise<PairLeague[]> {
  return (await listedLeagues()).map(({ id, name }) => ({ id, name }));
}

// Either player in an active pair of the league.
export function activePairWith(leagueId: number, userIds: string[]) {
  return sql`exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active'
    and (${inArray(pairs.playerA, userIds)} or ${inArray(pairs.playerB, userIds)}))`;
}

export type PairOverview = {
  league: PairLeague;
  // The partner's address and phone (D121): partners have to reach each
  // other, also when the organizer paired two strangers. Only on Párom, to
  // the pair's own two players. Phone formatted, "" when none.
  pair: { id: number; partnerName: string; partnerEmail: string; partnerPhone: string } | null;
};

// What /pair shows, per league: the active pair, if any.
export async function pairOverview(user: User, list: PairLeague[]): Promise<PairOverview[]> {
  if (list.length === 0) return [];
  const partner = alias(users, "partner");
  const active = await db
    .select({
      id: pairs.id,
      leagueId: pairs.leagueId,
      partnerName: partner.name,
      partnerEmail: partner.email,
      partnerPhone: partner.phone,
    })
    .from(pairs)
    .innerJoin(partner, sql`${partner.id} = case when ${pairs.playerA} = ${user.id} then ${pairs.playerB} else ${pairs.playerA} end`)
    .where(
      and(
        inArray(
          pairs.leagueId,
          list.map((l) => l.id),
        ),
        eq(pairs.status, "active"),
        or(eq(pairs.playerA, user.id), eq(pairs.playerB, user.id)),
      ),
    );
  return list.map((league) => {
    const p = active.find((a) => a.leagueId === league.id);
    return {
      league,
      pair: p
        ? { id: p.id, partnerName: p.partnerName, partnerEmail: p.partnerEmail, partnerPhone: formatPhone(p.partnerPhone) }
        : null,
    };
  });
}

// --- The organizer's Párok page (#97) ----------------------------------------

export type LeaguePairRow = {
  id: number;
  // phone: formatted ("+36 30 123 4567"), "" when none. The league's
  // Szervező and the Admin call players from Párok (D126); never public.
  players: { id: string; name: string; level: string | null; phone: string }[];
  elo: number | null;
  source: PairSource;
  status: "active" | "dissolved";
  // In a published group whose round hasn't ended: can't be dissolved or changed.
  locked: boolean;
  // The seasons of those groups: taking the pair out of one of them is a
  // mid-round withdrawal (#34).
  lockedIn: number[];
  // The entry in the league's current (or next) season, if any.
  entry: { seasonId: number; season: string; status: EntryStatus; joinsPhase: number | null } | null;
  // "Benevezés" or "Kivétel a szezonból" for an active pair (#154), or none.
  entryAction: OrganizerEntryAction | null;
  // The league's first home season (current or next), so "not entered" can
  // say which; null when there is none.
  season: string | null;
};

const playerA = alias(users, "pair_player_a");
const playerB = alias(users, "pair_player_b");

// The league's active pairs that are in a published group before its round's
// deadline, with the seasons of those groups. Filtered by league, not by a
// list of ids (D1: at most 100 bound parameters per statement).
async function lockedPairs(leagueId: number, now: Date): Promise<Map<number, number[]>> {
  const rows = await db
    .selectDistinct({ id: groupPairs.pairId, seasonId: groups.seasonId })
    .from(groupPairs)
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(seasonPhases, and(eq(seasonPhases.seasonId, groups.seasonId), eq(seasonPhases.number, groups.phase)))
    .where(
      and(
        eq(pairs.leagueId, leagueId),
        eq(pairs.status, "active"),
        // A pair withdrawn from its group (#34) plays there no more.
        isNull(groupPairs.withdrawnAt),
        isNotNull(groups.publishedAt),
        gte(seasonPhases.deadline, now),
      ),
    );
  const out = new Map<number, number[]>();
  for (const r of rows) out.set(r.id, [...(out.get(r.id) ?? []), r.seasonId]);
  return out;
}

// Every pair of the league, active ones first, newest first.
export async function leaguePairs(leagueId: number, now = new Date()): Promise<LeaguePairRow[]> {
  const rows = await db
    .select({
      id: pairs.id,
      source: pairs.source,
      status: pairs.status,
      aId: pairs.playerA,
      aName: playerA.name,
      aLevel: playerA.level,
      aElo: playerA.elo,
      aPhone: playerA.phone,
      bId: pairs.playerB,
      bName: playerB.name,
      bLevel: playerB.level,
      bElo: playerB.elo,
      bPhone: playerB.phone,
    })
    .from(pairs)
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(eq(pairs.leagueId, leagueId))
    .orderBy(asc(pairs.status), desc(pairs.id));
  if (rows.length === 0) return [];
  const seasons = homeSeasons(await listSeasons(leagueId), now);
  const [locked, entries] = await Promise.all([
    lockedPairs(leagueId, now),
    seasons.length
      ? db
          .select({
            pairId: seasonEntries.pairId,
            seasonId: seasonEntries.seasonId,
            status: seasonEntries.status,
            joinsPhase: seasonEntries.joinsPhase,
          })
          .from(seasonEntries)
          .where(
            inArray(
              seasonEntries.seasonId,
              seasons.map((s) => s.id),
            ),
          )
      : Promise.resolve([]),
  ]);
  return rows.map((r) => {
    const entry = homeEntry(seasons, entries, r.id);
    return {
      id: r.id,
      players: [
        { id: r.aId, name: r.aName, level: r.aLevel, phone: formatPhone(r.aPhone) },
        { id: r.bId, name: r.bName, level: r.bLevel, phone: formatPhone(r.bPhone) },
      ],
      elo: averageElo({ elo: r.aElo, level: r.aLevel }, { elo: r.bElo, level: r.bLevel }),
      source: r.source,
      status: r.status,
      locked: locked.has(r.id),
      lockedIn: locked.get(r.id) ?? [],
      entry,
      entryAction: r.status === "active" ? organizerEntryAction(seasons, entry, now) : null,
      season: seasons[0]?.name ?? null,
    };
  });
}

// phone: formatted, "" when none; for Párok's rows only (D126), never in the
// player choices.
export type PairCandidate = { id: string; name: string; level: string | null; phone: string };

// Registered players (first-login page done) of the league without an active
// pair in it, by name: the league's players by D128 (league-members.server.ts,
// replacing D93), staff accounts too. No address in the result: it goes to
// the page.
export async function pairCandidates(league: { id: number }): Promise<PairCandidate[]> {
  const accounts = await db
    .select({ id: users.id, name: users.name, level: users.level, phone: users.phone })
    .from(users)
    .where(
      and(
        isNotNull(users.consentAt),
        memberOf(league.id, users.id),
        sql`not exists (select 1 from ${pairs} where ${pairs.leagueId} = ${league.id} and ${pairs.status} = 'active'
          and (${pairs.playerA} = ${users.id} or ${pairs.playerB} = ${users.id}))`,
      ),
    )
    .orderBy(asc(users.name), asc(users.id));
  return accounts.map(({ id, name, level, phone }) => ({ id, name, level, phone: formatPhone(phone) }));
}

// Why `a` and `b` can't be a new pair, or null. `free`: the players who must
// not be in an active pair (both, unless one leaves their pair in the same
// step).
async function newPairRefusal(leagueId: number, a: string, b: string, free = [a, b]): Promise<string | null> {
  if (!a || !b || a === b) return NEW_PAIR_REFUSALS.same;
  const [registered, paired] = await db.batch([
    db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, [a, b]), isNotNull(users.consentAt))),
    db.select({ id: pairs.id }).from(pairs).where(activePairWith(leagueId, free)).limit(1),
  ]);
  const refusal = checkNewPair({ a, b, registered: registered.length === 2, paired: paired.length > 0 });
  return refusal ? NEW_PAIR_REFUSALS[refusal] : null;
}

// The active pair of exactly these two players in the league, if any.
async function activePairOf(leagueId: number, a: string, b: string): Promise<number | null> {
  const [row] = await db
    .select({ id: pairs.id })
    .from(pairs)
    .where(
      and(
        eq(pairs.leagueId, leagueId),
        eq(pairs.status, "active"),
        or(and(eq(pairs.playerA, a), eq(pairs.playerB, b)), and(eq(pairs.playerA, b), eq(pairs.playerB, a))),
      ),
    );
  return row?.id ?? null;
}

// The insert of a new pair: only if neither player is in an active pair of
// the league by then (checked inside the statement, so two organizers or two
// accepts at once can't put a player in two pairs). A builder, not a raw
// db.run(), so it can go in a D1 batch with its audit entry.
export function insertPairIfFree(leagueId: number, a: string, b: string, source: Exclude<PairSource, "signup">) {
  return db.insert(pairs).select(
    rowSelect(
      pairs,
      {
        id: sql`null`,
        leagueId: sql`${leagueId}`,
        playerA: sql`${a}`,
        playerB: sql`${b}`,
        inviteId: sql`null`,
        status: sql`'active'`,
        source: sql`${source}`,
        dissolvedAt: sql`null`,
        dissolvedBy: sql`null`,
        createdAt: sql`unixepoch()`,
      },
      sql`where not ${activePairWith(leagueId, [a, b])}`,
    ),
  );
}

// The active pair of these two players in the league, inside a batch.
export const activePairIdOf = (leagueId: number, a: string, b: string) =>
  sql`(select ${pairs.id} from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active'
    and ${pairs.playerA} = ${a} and ${pairs.playerB} = ${b})`;

// An organizer formed this pair (#260, replacing D59's "no email"): both
// players get the in-app message and the email, with the partner's address
// and phone (D121). The pair is saved already;
// a notice problem must not turn the action into an error.
async function announcePair(pairId: number): Promise<void> {
  try {
    const players = await pairPlayers(pairId);
    if (!players) return;
    const message = partnerFoundMessage(players.league);
    await notifyPlayers("pair_intro", [players.a, players.b].map((p) => ({ userId: p.id, message })));
    await queuePairCreated(
      [
        [players.a, players.b],
        [players.b, players.a],
      ].map(([to, partner]) => ({
        toEmail: to.email,
        input: {
          to: to.name,
          partnerName: partner.name,
          partnerEmail: partner.email,
          partnerPhone: formatPhone(partner.phone),
          league: players.league,
        },
      })),
    );
  } catch (e) {
    console.error("pair created notice failed", e);
  }
}

// "Pár létrehozása": two registered players without a pair in the league.
// `source`: "search" when made from Regisztráltak on Párkeresők (D113, #297),
// so its Összehozott párok can list it.
export async function createPair(
  actorId: string,
  leagueId: number,
  a: string,
  b: string,
  source: "manual" | "search" = "manual",
): Promise<Result> {
  const refused = await newPairRefusal(leagueId, a, b);
  if (refused) return { ok: false, error: refused };
  await db.batch([
    insertPairIfFree(leagueId, a, b, source),
    auditIfChanged({
      actorId,
      action: "pair.create",
      target: sql`'pair:' || ${activePairIdOf(leagueId, a, b)}`,
      detail: `league:${leagueId}; user:${a} + user:${b}`,
      leagueId,
    }),
    ...pairMemberStatements(leagueId, a, b, () => "pair"),
  ]);
  // Someone was quicker with one of them.
  const id = await activePairOf(leagueId, a, b);
  if (!id) return { ok: false, error: NEW_PAIR_REFUSALS.paired };
  await announcePair(id);
  return { ok: true };
}

type StoredPair = { status: "active" | "dissolved"; playerA: string; playerB: string };

async function pairInLeague(leagueId: number, pairId: number): Promise<StoredPair | undefined> {
  const [row] = await db
    .select({ status: pairs.status, playerA: pairs.playerA, playerB: pairs.playerB })
    .from(pairs)
    .where(and(eq(pairs.id, pairId), eq(pairs.leagueId, leagueId)));
  return row;
}

const GONE = "Ez a pár már nem aktív.";

export const NEW_PARTNER_REFUSED = "Válassz új partnert.";

// The dissolve itself: the update, then the withdrawal of the entries it
// hasn't played in yet (D19), in one batch with whatever follows. The
// running-group check is repeated in the update, so a group published in the
// meantime wins; the withdrawal only runs once the pair is dissolved.
// `also`: an extra condition for the update. `logged`: write a pair.dissolve
// audit entry if the update dissolved it (#225), in the same batch.
export function dissolveStatements(
  actorId: string,
  pairId: number,
  now: Date,
  also = sql`1`,
  logged?: { leagueId: number; detail?: string },
) {
  const update = db
    .update(pairs)
    .set({ status: "dissolved", dissolvedAt: now, dissolvedBy: actorId })
    .where(and(eq(pairs.id, pairId), eq(pairs.status, "active"), notInRunningGroup(pairId, now), also))
    .returning({ id: pairs.id });
  if (!logged) return [update, withdrawEntries(pairId, now)] as const;
  const detail = `league:${logged.leagueId}${logged.detail ? `; ${logged.detail}` : ""}`;
  return [
    update,
    auditIfChanged({ actorId, action: "pair.dissolve", target: `pair:${pairId}`, detail, leagueId: logged.leagueId }),
    withdrawEntries(pairId, now),
  ] as const;
}

// Why a dissolve in a batch changed nothing, from the state now.
async function whyNotDissolved(leagueId: number, pairId: number, now: Date): Promise<string> {
  const pair = await pairInLeague(leagueId, pairId);
  if (!pair || pair.status !== "active") return GONE;
  return (await pairInRunningGroup(pairId, now)) ? DISSOLVE_REFUSED : NEW_PAIR_REFUSALS.paired;
}

// "Felbontás": not while the pair plays in a running round.
export async function dissolvePair(actorId: string, leagueId: number, pairId: number, now = new Date()): Promise<Result> {
  const pair = await pairInLeague(leagueId, pairId);
  if (!pair || pair.status !== "active") return { ok: false, error: GONE };
  if (!canDissolve(pair, await pairInRunningGroup(pairId, now))) return { ok: false, error: DISSOLVE_REFUSED };
  const [dissolved] = await db.batch(dissolveStatements(actorId, pairId, now, sql`1`, { leagueId }));
  if (dissolved.length === 0) return { ok: false, error: await whyNotDissolved(leagueId, pairId, now) };
  return { ok: true };
}

// "Partner cseréje": dissolves the pair and pairs `keep` (one of its players)
// with `partner`, in one batch: both happen or neither.
export async function changePartner(
  actorId: string,
  leagueId: number,
  pairId: number,
  keep: string,
  partner: string,
  now = new Date(),
): Promise<Result> {
  const pair = await pairInLeague(leagueId, pairId);
  if (!pair || pair.status !== "active" || (keep !== pair.playerA && keep !== pair.playerB)) return { ok: false, error: GONE };
  const leaving = keep === pair.playerA ? pair.playerB : pair.playerA;
  if (partner === keep || partner === leaving) return { ok: false, error: NEW_PARTNER_REFUSED };
  if (!canDissolve(pair, await pairInRunningGroup(pairId, now))) return { ok: false, error: DISSOLVE_REFUSED };
  // `keep` leaves this pair in the same step: only the new partner must be free.
  const refused = await newPairRefusal(leagueId, keep, partner, [partner]);
  if (refused) return { ok: false, error: refused };
  // One batch (a transaction in D1). The old pair only goes if the new
  // partner is still free. The new pair keeps `keep` in the same column, so
  // if the old pair is still active its unique index (one active pair per
  // player and column) fails the insert, and the whole batch rolls back.
  // A raw db.run() can't go in a D1 batch, hence the builder.
  const values = keep === pair.playerA ? { playerA: keep, playerB: partner } : { playerA: partner, playerB: keep };
  try {
    await db.batch([
      ...dissolveStatements(actorId, pairId, now, sql`not ${activePairWith(leagueId, [partner])}`),
      db.insert(pairs).values({ leagueId, ...values, source: "manual" }),
      // The insert either happened or failed the batch.
      auditEntry({
        actorId,
        action: "pair.change",
        target: sql`'pair:' || ${activePairIdOf(leagueId, values.playerA, values.playerB)}`,
        detail: `league:${leagueId}; from pair:${pairId}; user:${leaving} -> user:${partner}`,
        leagueId,
      }),
      ...pairMemberStatements(leagueId, values.playerA, values.playerB, () => "pair"),
    ]);
  } catch (e) {
    if (!/UNIQUE/i.test(String(e))) throw e;
    return { ok: false, error: await whyNotDissolved(leagueId, pairId, now) };
  }
  const id = await activePairOf(leagueId, values.playerA, values.playerB);
  if (id) await announcePair(id);
  return { ok: true };
}

import { DIVISION_NAMES, divisionOf } from "@padel-liga/rules";
import { and, asc, desc, eq, isNotNull, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { groupPairs, groups, pairs, users } from "~/db/schema";

import { teamLabel } from "./names";

const playerA = alias(users, "shell_player_a");
const playerB = alias(users, "shell_player_b");

export type ShellTeam = {
  pairId: number;
  // The pair's team label, "Kovács / Nagy" (#419).
  name: string;
  // "Bronz": the division of the pair's newest published group, if any.
  division: string | null;
  // The user is the pair's first player (the darker circle of its TeamBadge).
  first: boolean;
};

/**
 * The team on the sidebar's user chip (D181): the pair the Tabella opens
 * (the user's first active pair, as playerLeagueSlug picks it), with the
 * division of its newest published group. Null without an active pair. Only
 * the user's own pair: names, no contact data.
 */
export async function shellTeam(userId: string): Promise<ShellTeam | null> {
  const [pair] = await db
    .select({
      id: pairs.id,
      a: pairs.playerA,
      b: pairs.playerB,
      aName: playerA.name,
      aSurname: playerA.surname,
      aFirstName: playerA.firstName,
      bName: playerB.name,
      bSurname: playerB.surname,
      bFirstName: playerB.firstName,
    })
    .from(pairs)
    .innerJoin(playerA, eq(playerA.id, pairs.playerA))
    .innerJoin(playerB, eq(playerB.id, pairs.playerB))
    .where(and(eq(pairs.status, "active"), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))))
    .orderBy(asc(pairs.id))
    .limit(1);
  if (!pair) return null;
  const [group] = await db
    .select({ seasonId: groups.seasonId, phase: groups.phase, number: groups.number })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .where(and(eq(groupPairs.pairId, pair.id), isNull(groupPairs.withdrawnAt), isNotNull(groups.publishedAt)))
    .orderBy(desc(groups.seasonId), desc(groups.phase))
    .limit(1);
  let division: string | null = null;
  if (group) {
    // The division is the group's place among its round's published groups.
    const round = await db
      .select({ number: groups.number })
      .from(groups)
      .where(and(eq(groups.seasonId, group.seasonId), eq(groups.phase, group.phase), isNotNull(groups.publishedAt)));
    const position = round.filter((g) => g.number <= group.number).length;
    division = DIVISION_NAMES[divisionOf(position, round.length)];
  }
  return {
    pairId: pair.id,
    name: teamLabel([
      { id: pair.a, name: pair.aName, surname: pair.aSurname, firstName: pair.aFirstName },
      { id: pair.b, name: pair.bName, surname: pair.bSurname, firstName: pair.bFirstName },
    ]),
    division,
    first: pair.a === userId,
  };
}

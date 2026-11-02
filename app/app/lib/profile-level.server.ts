import { and, eq, isNotNull, or } from "drizzle-orm";

import { db } from "~/db/client.server";
import { groupPairs, groups, pairs } from "~/db/schema";

// Whether the player took part in a season (#135): one of their pairs, active
// or not, was placed in a group that is published. A draft group doesn't
// count (the organizer can still move pairs out of it), and a pair that was
// dissolved afterwards still did take part.
export async function hasTakenPartInSeason(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ pairId: groupPairs.pairId })
    .from(groupPairs)
    .innerJoin(groups, eq(groups.id, groupPairs.groupId))
    .innerJoin(pairs, eq(pairs.id, groupPairs.pairId))
    .where(and(isNotNull(groups.publishedAt), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))))
    .limit(1);
  return !!row;
}

import { and, eq, isNotNull, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { leagues, pairLinks, pairs, users } from "~/db/schema";
import { randomToken } from "~/lib/auth/tokens";
import { auditIfChanged } from "~/lib/audit.server";

import type { User } from "./auth/session.server";
import { activePairIdOf, activePairWith, insertPairIfFree, pairLeagues, type PairLeague } from "./pairs.server";
import { checkPairLink, PAIR_LINK_REFUSALS } from "./pairs";
import { pairMemberStatements, playerLeagues } from "./league-members.server";

// The pair link (decision log, 2026-10-31): every player without a
// pair in a league gets their own link to send to a partner. Whoever opens
// it, registers and accepts becomes the partner (pairs.source "link"), as
// long as neither of them is in an active pair of the league by then. No
// email: the player sends the link themselves.

export const pairLinkPath = (token: string) => `/pair/join/${token}`;

// The player's link in the league, made on first use. 18 random bytes: 24
// characters, short enough for an SMS, too many to guess.
export async function pairLinkFor(userId: string, leagueId: number): Promise<string> {
  await db.insert(pairLinks).values({ leagueId, ownerId: userId, token: randomToken(18) }).onConflictDoNothing();
  const [row] = await db
    .select({ token: pairLinks.token })
    .from(pairLinks)
    .where(and(eq(pairLinks.leagueId, leagueId), eq(pairLinks.ownerId, userId)));
  return row.token;
}

export type PairLinkBox = { league: PairLeague; token: string };

// The links /home and /pair show: one per league of the player (D127) where they have no
// active pair.
export async function pairLinkBoxes(user: Pick<User, "id">, list?: PairLeague[]): Promise<PairLinkBox[]> {
  const shown = list ?? (await playerLeagues(user.id));
  const out: PairLinkBox[] = [];
  for (const league of shown) {
    const [paired] = await db.select({ id: pairs.id }).from(pairs).where(activePairWith(league.id, [user.id])).limit(1);
    if (!paired) out.push({ league, token: await pairLinkFor(user.id, league.id) });
  }
  return out;
}

export type PairLinkView = {
  league: string;
  ownerName: string;
  // Null: the player may accept. Not logged in: no check yet.
  refusal: string | null;
};

type StoredLink = { id: number; leagueId: number; league: string; ownerId: string; ownerName: string };

async function linkByToken(token: string): Promise<StoredLink | undefined> {
  if (!token) return undefined;
  const [row] = await db
    .select({ id: pairLinks.id, leagueId: pairLinks.leagueId, league: leagues.name, ownerId: pairLinks.ownerId, ownerName: users.name })
    .from(pairLinks)
    .innerJoin(leagues, eq(leagues.id, pairLinks.leagueId))
    // The owner finished the first-login page (they saw the link only after it).
    .innerJoin(users, and(eq(users.id, pairLinks.ownerId), isNotNull(users.consentAt)))
    .where(eq(pairLinks.token, token));
  // Only leagues players can see (a listed city).
  if (!row || !(await pairLeagues()).some((l) => l.id === row.leagueId)) return undefined;
  return row;
}

async function refusalFor(link: StoredLink, userId: string): Promise<string | null> {
  const [mine, theirs] = await db.batch([
    db.select({ id: pairs.id }).from(pairs).where(activePairWith(link.leagueId, [userId])).limit(1),
    db.select({ id: pairs.id }).from(pairs).where(activePairWith(link.leagueId, [link.ownerId])).limit(1),
  ]);
  const refusal = checkPairLink({ ownerId: link.ownerId, userId, userPaired: mine.length > 0, ownerPaired: theirs.length > 0 });
  return refusal ? PAIR_LINK_REFUSALS[refusal] : null;
}

// What the link's page shows; undefined for a link that doesn't exist.
// The owner's name only, never their email or phone.
export async function pairLinkView(token: string, user: Pick<User, "id"> | null): Promise<PairLinkView | undefined> {
  const link = await linkByToken(token);
  if (!link) return undefined;
  return { league: link.league, ownerName: link.ownerName, refusal: user ? await refusalFor(link, user.id) : null };
}

// "Elfogadom": the pair, if both are still without one. The check is
// repeated inside the insert, so two accepts at once can't make two pairs.
export async function acceptPairLink(user: Pick<User, "id" | "consentAt">, token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const link = await linkByToken(token);
  if (!link) return { ok: false, error: "Ez a link nem él." };
  if (!user.consentAt) return { ok: false, error: "Előbb fejezd be a regisztrációt." };
  const refused = await refusalFor(link, user.id);
  if (refused) return { ok: false, error: refused };
  await db.batch([
    insertPairIfFree(link.leagueId, link.ownerId, user.id, "link"),
    auditIfChanged({
      actorId: user.id,
      action: "pair.link",
      target: sql`'pair:' || ${activePairIdOf(link.leagueId, link.ownerId, user.id)}`,
      detail: `league:${link.leagueId}; link:${link.id}; user:${link.ownerId} + user:${user.id}`,
      leagueId: link.leagueId,
    }),
    // Accepting a pair link joins its league (D127, #331).
    ...pairMemberStatements(link.leagueId, link.ownerId, user.id, (id) => (id === user.id ? "link" : "pair")),
  ]);
  const [pair] = await db
    .select({ id: pairs.id })
    .from(pairs)
    .where(and(eq(pairs.leagueId, link.leagueId), eq(pairs.status, "active"), eq(pairs.playerA, link.ownerId), eq(pairs.playerB, user.id)));
  // Someone was quicker with one of them.
  if (!pair) return { ok: false, error: (await refusalFor(link, user.id)) ?? PAIR_LINK_REFUSALS.owner_paired };
  return { ok: true };
}

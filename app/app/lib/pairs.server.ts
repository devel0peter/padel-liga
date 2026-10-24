import { and, asc, count, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { accountInvites, leagues, pairInvites, pairs, users } from "~/db/schema";
import { listedCities } from "~/lib/cities.server";
import { queuePairAnswer, queuePairDissolved, queuePairInvite } from "~/lib/email/outbox.server";
import { notInRunningGroup, pairInRunningGroup } from "~/lib/groups.server";
import { withdrawEntries } from "~/lib/season-entries.server";
import { SITE_URL } from "~/lib/site";

import { normalizeEmail } from "./auth/rules";
import type { User } from "./auth/session.server";
import { randomToken, sha256Hex } from "./auth/tokens";
import {
  ANSWER_REFUSALS,
  CANCEL_REFUSED,
  canCancel,
  canDissolve,
  checkAnswer,
  checkInvite,
  DISSOLVE_REFUSED,
  INVITE_REFUSALS,
  inviteLink,
  PAIR_INVITE_NOTE,
  type InviteStatus,
} from "./pairs";

// Pairs and partner invites in D1 (#21). The rules are in pairs.ts.

export type PairLeague = { id: number; name: string };

// Where a player can form a pair: every league in a listed city (players
// don't belong to a league yet; a city still being set up stays hidden).
export async function pairLeagues(): Promise<PairLeague[]> {
  const listed = (await listedCities()).map((c) => c.slug);
  if (listed.length === 0) return [];
  return db
    .select({ id: leagues.id, name: leagues.name })
    .from(leagues)
    .where(inArray(leagues.city, listed))
    .orderBy(asc(leagues.name));
}

// Either player in an active pair of the league.
function activePairWith(leagueId: number, userIds: string[]) {
  return sql`exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId} and ${pairs.status} = 'active'
    and (${inArray(pairs.playerA, userIds)} or ${inArray(pairs.playerB, userIds)}))`;
}

async function isPaired(leagueId: number, userId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: pairs.id })
    .from(pairs)
    .where(and(eq(pairs.leagueId, leagueId), eq(pairs.status, "active"), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))))
    .limit(1);
  return !!row;
}


export type PairOverview = {
  league: PairLeague;
  pair: { id: number; partnerName: string; canDissolve: boolean } | null;
  // The invite this player sent and nobody has answered yet.
  sent: { id: number; email: string; createdAt: Date } | null;
  // Invites to this player's email, from players without a pair here.
  received: { id: number; inviterName: string; createdAt: Date }[];
};

// What /pair shows, per league.
export async function pairOverview(user: User, list: PairLeague[]): Promise<PairOverview[]> {
  if (list.length === 0) return [];
  const ids = list.map((l) => l.id);
  const partner = alias(users, "partner");
  const inviter = alias(users, "inviter");
  const [active, sent, received] = await db.batch([
    db
      .select({ id: pairs.id, leagueId: pairs.leagueId, playerA: pairs.playerA, playerB: pairs.playerB, partnerName: partner.name })
      .from(pairs)
      .innerJoin(
        partner,
        sql`${partner.id} = case when ${pairs.playerA} = ${user.id} then ${pairs.playerB} else ${pairs.playerA} end`,
      )
      .where(and(inArray(pairs.leagueId, ids), eq(pairs.status, "active"), or(eq(pairs.playerA, user.id), eq(pairs.playerB, user.id)))),
    db
      .select({ id: pairInvites.id, leagueId: pairInvites.leagueId, email: pairInvites.inviteeEmail, createdAt: pairInvites.createdAt })
      .from(pairInvites)
      .where(and(inArray(pairInvites.leagueId, ids), eq(pairInvites.inviterId, user.id), eq(pairInvites.status, "pending"))),
    db
      .select({ id: pairInvites.id, leagueId: pairInvites.leagueId, inviterName: inviter.name, createdAt: pairInvites.createdAt })
      .from(pairInvites)
      .innerJoin(inviter, eq(inviter.id, pairInvites.inviterId))
      .where(
        and(
          inArray(pairInvites.leagueId, ids),
          eq(pairInvites.inviteeEmail, normalizeEmail(user.email)),
          eq(pairInvites.status, "pending"),
        ),
      )
      .orderBy(desc(pairInvites.id)),
  ]);
  return Promise.all(
    list.map(async (league) => {
      const p = active.find((a) => a.leagueId === league.id);
      const s = sent.find((x) => x.leagueId === league.id);
      return {
        league,
        pair: p
          ? { id: p.id, partnerName: p.partnerName, canDissolve: canDissolve({ ...p, status: "active" }, user.id, await pairInRunningGroup(p.id)) }
          : null,
        sent: s ? { id: s.id, email: s.email, createdAt: s.createdAt } : null,
        received: received.filter((r) => r.leagueId === league.id).map(({ id, inviterName, createdAt }) => ({ id, inviterName, createdAt })),
      };
    }),
  );
}

type Result = { ok: true } | { ok: false; error: string };

// Sends a partner invite (D13-D15). An invitee without an account is added to
// account_invites, so they can sign up before registration opens (D14).
export async function createInvite(user: User, league: PairLeague, rawEmail: string): Promise<Result> {
  const email = normalizeEmail(rawEmail);
  const [[invitee], [sentLastDay], [pending]] = await db.batch([
    db.select({ id: users.id }).from(users).where(eq(users.email, email)),
    db
      .select({ n: count() })
      .from(pairInvites)
      .where(and(eq(pairInvites.inviterId, user.id), gt(pairInvites.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000)))),
    db
      .select({ n: count() })
      .from(pairInvites)
      .where(and(eq(pairInvites.leagueId, league.id), eq(pairInvites.inviterId, user.id), eq(pairInvites.status, "pending"))),
  ]);
  const check = checkInvite({
    inviterEmail: user.email,
    inviteeEmail: email,
    inviterPaired: await isPaired(league.id, user.id),
    inviteePaired: invitee ? await isPaired(league.id, invitee.id) : false,
    pendingOutgoing: pending.n > 0,
    sentLastDay: sentLastDay.n,
  });
  if (!check.ok) return { ok: false, error: INVITE_REFUSALS[check.reason] };

  const token = randomToken();
  // The unique index on pending invites per inviter and league settles a
  // double submit: the second insert does nothing.
  const inserted = await db
    .insert(pairInvites)
    .values({ leagueId: league.id, inviterId: user.id, inviteeEmail: check.email, tokenHash: await sha256Hex(token) })
    .onConflictDoNothing()
    .returning({ id: pairInvites.id });
  if (inserted.length === 0) return { ok: false, error: INVITE_REFUSALS.already_inviting };
  if (!invitee) await db.insert(accountInvites).values({ email: check.email, note: PAIR_INVITE_NOTE }).onConflictDoNothing();
  await queuePairInvite(check.email, {
    inviterName: user.name,
    league: league.name,
    link: inviteLink(SITE_URL, token, { email: check.email, hasAccount: !!invitee }),
    hasAccount: !!invitee,
  });
  return { ok: true };
}

export async function cancelInvite(user: User, inviteId: number): Promise<Result> {
  const [invite] = await db
    .select({ status: pairInvites.status, inviterId: pairInvites.inviterId })
    .from(pairInvites)
    .where(eq(pairInvites.id, inviteId));
  if (!invite || !canCancel(invite, user.id)) return { ok: false, error: CANCEL_REFUSED };
  // Only while still pending: the invitee may have answered in the meantime.
  const updated = await db
    .update(pairInvites)
    .set({ status: "cancelled", respondedAt: new Date() })
    .where(and(eq(pairInvites.id, inviteId), eq(pairInvites.inviterId, user.id), eq(pairInvites.status, "pending")))
    .returning({ id: pairInvites.id });
  return updated.length ? { ok: true } : { ok: false, error: CANCEL_REFUSED };
}

export type InviteDetails = {
  id: number;
  leagueId: number;
  league: string;
  inviterId: string;
  inviterName: string;
  inviterEmail: string;
  inviteeEmail: string;
  status: InviteStatus;
};

const inviter = alias(users, "inviter");

function inviteDetails() {
  return db
    .select({
      id: pairInvites.id,
      leagueId: pairInvites.leagueId,
      league: leagues.name,
      inviterId: pairInvites.inviterId,
      inviterName: inviter.name,
      inviterEmail: inviter.email,
      inviteeEmail: pairInvites.inviteeEmail,
      status: pairInvites.status,
    })
    .from(pairInvites)
    .innerJoin(inviter, eq(inviter.id, pairInvites.inviterId))
    .innerJoin(leagues, eq(leagues.id, pairInvites.leagueId));
}

// The invite behind an emailed link (only the token's hash is stored).
export async function inviteByToken(token: string): Promise<InviteDetails | undefined> {
  const [row] = await inviteDetails().where(eq(pairInvites.tokenHash, await sha256Hex(token)));
  return row;
}

export async function inviteById(id: number): Promise<InviteDetails | undefined> {
  const [row] = await inviteDetails().where(eq(pairInvites.id, id));
  return row;
}

// Accept or decline as the invitee. Accepting forms the pair and cancels both
// players' other pending invites in the league, in one D1 batch (a
// transaction), so two accepts at once can't put a player in two pairs.
export async function answerInvite(user: User, inviteId: number, answer: "accept" | "decline"): Promise<Result> {
  const invite = await inviteById(inviteId);
  if (!invite) return { ok: false, error: ANSWER_REFUSALS.answered };
  const refusal = async () =>
    checkAnswer(
      {
        status: invite.status,
        inviteeEmail: invite.inviteeEmail,
        userEmail: user.email,
        inviterPaired: await isPaired(invite.leagueId, invite.inviterId),
        userPaired: await isPaired(invite.leagueId, user.id),
      },
      answer,
    );
  // Accepting again (a second tab, a double submit) finds the pair this
  // invite formed: done, and the inviter was told the first time.
  const formedHere = async () => {
    const [formed] = await db
      .select({ id: pairs.id })
      .from(pairs)
      .where(and(eq(pairs.inviteId, inviteId), eq(pairs.status, "active"), eq(pairs.playerB, user.id)));
    return !!formed;
  };
  if (answer === "accept" && invite.status === "accepted" && (await formedHere())) return { ok: true };
  const refused = await refusal();
  if (refused) return { ok: false, error: ANSWER_REFUSALS[refused] };
  const now = new Date();

  if (answer === "decline") {
    const updated = await db
      .update(pairInvites)
      .set({ status: "declined", respondedAt: now })
      .where(and(eq(pairInvites.id, inviteId), eq(pairInvites.status, "pending")))
      .returning({ id: pairInvites.id });
    if (updated.length === 0) return { ok: false, error: ANSWER_REFUSALS.answered };
    await queuePairAnswer(invite.inviterEmail, { to: invite.inviterName, inviteeName: user.name, league: invite.league, accepted: false });
    return { ok: true };
  }

  const players = [invite.inviterId, user.id];
  const emails = [normalizeEmail(invite.inviterEmail), normalizeEmail(user.email)];
  const pairOfInvite = sql`exists (select 1 from ${pairs} where ${pairs.inviteId} = ${inviteId} and ${pairs.status} = 'active')`;
  const [accepted] = await db.batch([
    db
      .update(pairInvites)
      .set({ status: "accepted", respondedAt: now })
      .where(
        and(
          eq(pairInvites.id, inviteId),
          eq(pairInvites.status, "pending"),
          eq(pairInvites.inviteeEmail, emails[1]),
          sql`not ${activePairWith(invite.leagueId, players)}`,
        ),
      )
      .returning({ id: pairInvites.id }),
    db.run(sql`insert into ${pairs} (league_id, player_a, player_b, invite_id)
      select ${invite.leagueId}, ${invite.inviterId}, ${user.id}, ${inviteId}
      where exists (select 1 from ${pairInvites} where ${pairInvites.id} = ${inviteId} and ${pairInvites.status} = 'accepted')
        and not exists (select 1 from ${pairs} where ${pairs.inviteId} = ${inviteId})
        and not ${activePairWith(invite.leagueId, players)}`),
    db
      .update(pairInvites)
      .set({ status: "cancelled", respondedAt: now })
      .where(
        and(
          eq(pairInvites.leagueId, invite.leagueId),
          eq(pairInvites.status, "pending"),
          or(inArray(pairInvites.inviterId, players), inArray(pairInvites.inviteeEmail, emails)),
          pairOfInvite,
        ),
      ),
  ]);
  // Statement 1 changed the invite only if this batch formed the pair.
  if (accepted.length === 0) {
    // Two submits at once: the other one formed it and told the inviter.
    if (await formedHere()) return { ok: true };
    // Someone was quicker: say why, from the state now.
    const again = await inviteById(inviteId);
    if (again) invite.status = again.status;
    return { ok: false, error: ANSWER_REFUSALS[(await refusal()) ?? "answered"] };
  }
  await queuePairAnswer(invite.inviterEmail, { to: invite.inviterName, inviteeName: user.name, league: invite.league, accepted: true });
  return { ok: true };
}

// "Pár megszüntetése" (D16): either player, not while the pair plays in a
// group of a running phase. The partner is emailed (#85); the player who
// dissolved it is not. Its season entries not played yet are withdrawn (D19).
export async function dissolvePair(user: User, pairId: number): Promise<Result> {
  const [pair] = await db
    .select({ status: pairs.status, playerA: pairs.playerA, playerB: pairs.playerB, league: leagues.name })
    .from(pairs)
    .innerJoin(leagues, eq(leagues.id, pairs.leagueId))
    .where(eq(pairs.id, pairId));
  if (!pair || (pair.playerA !== user.id && pair.playerB !== user.id) || pair.status !== "active")
    return { ok: false, error: "Ez a pár már nem létezik." };
  const now = new Date();
  if (!canDissolve(pair, user.id, await pairInRunningGroup(pairId, now))) return { ok: false, error: DISSOLVE_REFUSED };
  // With its entries for seasons it hasn't played in yet (D19), in one batch.
  // The running-group check is repeated in the update, so groups published
  // in the meantime win; the withdrawal only runs once the pair is dissolved.
  const [dissolved] = await db.batch([
    db
      .update(pairs)
      .set({ status: "dissolved", dissolvedAt: now, dissolvedBy: user.id })
      .where(and(eq(pairs.id, pairId), eq(pairs.status, "active"), notInRunningGroup(pairId, now)))
      .returning({ id: pairs.id }),
    withdrawEntries(pairId, now),
  ]);
  // Two submits at once: only the one that dissolved it sends the email.
  if (dissolved.length === 0)
    return (await pairInRunningGroup(pairId, now)) ? { ok: false, error: DISSOLVE_REFUSED } : { ok: true };
  const [partner] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, pair.playerA === user.id ? pair.playerB : pair.playerA));
  if (partner) await queuePairDissolved(partner.email, { to: partner.name, dissolverName: user.name, league: pair.league });
  return { ok: true };
}

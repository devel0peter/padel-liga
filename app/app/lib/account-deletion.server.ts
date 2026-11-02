import { and, eq, inArray, isNull, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import {
  accountInvites,
  auditLog,
  emailMessages,
  groups,
  interestSignups,
  leagueAdminInvites,
  leagueAdmins,
  loginCodes,
  notificationOptOuts,
  notifications,
  oauthAccounts,
  pairInvites,
  pairLinks,
  pairs,
  partnerSearches,
  pushSubscriptions,
  sessions,
  users,
} from "~/db/schema";
import { audit } from "~/lib/leagues.server";
import { dissolveStatements } from "~/lib/pairs.server";

import {
  anonymizedEmail,
  DELETED_NAME,
  DELETION_REFUSALS,
  deletionPlan,
  type DeletionMode,
  type DeletionPlan,
} from "./account-deletion";

// Deleting an account in D1 (#152). The rules are in account-deletion.ts.
// Each deletion is one batch (a transaction in D1), so it happens whole or
// not at all. No email goes out to anyone.

export type DeletionFacts = { history: Set<string>; playing: Set<string> };

const CHANGED = "Közben változott valami. Frissítsd az oldalt, és próbáld újra.";

// A pair of the user `u` is in a published group; with `now`, one whose
// phase hasn't reached its deadline yet.
function inPublishedGroup(u: SQLWrapper | string, now?: Date) {
  const running = now
    ? sql`and exists (select 1 from season_phases sp where sp.season_id = g.season_id and sp.number = g.phase
        and sp.deadline >= ${Math.floor(now.getTime() / 1000)})`
    : sql``;
  return sql`exists (select 1 from group_pairs gp join groups g on g.id = gp.group_id join pairs p on p.id = gp.pair_id
    where (p.player_a = ${u} or p.player_b = ${u}) and g.published_at is not null ${running})`;
}

// Who has history and who plays now, for every account at once (whole
// tables, no id lists: D1 binds at most 100 parameters).
export async function deletionFacts(now = new Date()): Promise<DeletionFacts> {
  const rows = await db
    .select({ id: users.id, playing: sql<number>`${inPublishedGroup(users.id, now)}` })
    .from(users)
    .where(and(isNull(users.deletedAt), inPublishedGroup(users.id)));
  return { history: new Set(rows.map((r) => r.id)), playing: new Set(rows.filter((r) => !!r.playing).map((r) => r.id)) };
}

type Target = { id: string; email: string; platformRole: "player" | "superadmin" };

async function target(userId: string): Promise<Target | undefined> {
  const [row] = await db
    .select({ id: users.id, email: users.email, platformRole: users.platformRole })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  return row;
}

export async function planDeletion(actorId: string, userId: string, now = new Date()): Promise<DeletionPlan> {
  const [row, facts] = await Promise.all([target(userId), deletionFacts(now)]);
  return deletionPlan({ actorId, target: row ?? null, history: facts.history.has(userId), playing: facts.playing.has(userId) });
}

const lower = (column: SQLWrapper) => sql`lower(${column})`;

// Everything personal tied to the account or its address, other than the
// users row and the pairs. `guard`: a condition every statement waits for
// (on anonymize: that the users row was anonymized in the same batch).
// The unsubscribe (email_suppressions) stays, so the address is never
// mailed again.
function personalDataStatements(userId: string, email: string, guard: SQL) {
  const mine = <T extends SQL | undefined>(c: T) => and(c, guard);
  return [
    db.delete(sessions).where(mine(eq(sessions.userId, userId))),
    db.delete(oauthAccounts).where(mine(eq(oauthAccounts.userId, userId))),
    db.delete(pushSubscriptions).where(mine(eq(pushSubscriptions.userId, userId))),
    db.delete(notifications).where(mine(eq(notifications.userId, userId))),
    db.delete(notificationOptOuts).where(mine(eq(notificationOptOuts.userId, userId))),
    db.delete(pairLinks).where(mine(eq(pairLinks.ownerId, userId))),
    db.delete(partnerSearches).where(mine(eq(partnerSearches.userId, userId))),
    db.delete(leagueAdmins).where(mine(eq(leagueAdmins.userId, userId))),
    db.delete(pairInvites).where(mine(or(eq(pairInvites.inviterId, userId), eq(lower(pairInvites.inviteeEmail), email)))),
    db.delete(loginCodes).where(mine(eq(loginCodes.email, email))),
    db.delete(accountInvites).where(mine(eq(accountInvites.email, email))),
    db.delete(leagueAdminInvites).where(mine(eq(lower(leagueAdminInvites.email), email))),
    // Interest list: a solo paired with one of their signups goes back to
    // the waiting list (as deleteSignup does); their own signups go; on
    // someone else's pair signup only their name and address go, and the
    // signer is asked for a partner's address again (D35).
    db
      .update(interestSignups)
      .set({ pairedWith: null, status: "new", updatedAt: new Date() })
      .where(
        mine(
          inArray(
            interestSignups.pairedWith,
            db.select({ id: interestSignups.id }).from(interestSignups).where(eq(lower(interestSignups.email1), email)),
          ),
        ),
      ),
    db.delete(interestSignups).where(mine(eq(lower(interestSignups.email1), email))),
    db
      .update(interestSignups)
      .set({ name2: null, email2: null, invited2At: null, updatedAt: new Date() })
      .where(mine(eq(lower(interestSignups.email2), email))),
    // Every stored email to them, sent or not (as for a signup deletion).
    db.delete(emailMessages).where(mine(eq(lower(emailMessages.toEmail), email))),
    // Old log rows that name the address (Szervező appointments).
    db
      .update(auditLog)
      .set({ target: `user:${userId}` })
      .where(mine(eq(lower(auditLog.target), email))),
  ];
}

export type DeletionResult = { ok: true; mode: DeletionMode } | { ok: false; error: string };

// "Törlés" on Felhasználók. `actorId`: the Admin (the route checks the
// permission; the rules here check whom).
export async function deleteAccount(actorId: string, userId: string, now = new Date()): Promise<DeletionResult> {
  const [row, plan] = await Promise.all([target(userId), planDeletion(actorId, userId, now)]);
  if (!plan.ok || !row) return { ok: false, error: DELETION_REFUSALS[plan.ok ? "gone" : plan.refusal] };
  const email = row.email.toLowerCase();
  const done = plan.mode === "remove" ? await remove(userId, email) : await anonymize(actorId, userId, email, now);
  if (!done) {
    // Something changed since the check: say why from the state now.
    const again = await planDeletion(actorId, userId, now);
    return { ok: false, error: again.ok ? CHANGED : DELETION_REFUSALS[again.refusal] };
  }
  // Who and when only: no name or email of the deleted person.
  await audit(actorId, plan.mode === "remove" ? "account.delete" : "account.anonymize", `user:${userId}`);
  return { ok: true, mode: plan.mode };
}

// No history: the pairs (none was ever in a published group, checked in the
// statement) and the account itself, with every row that cascades from
// them (entries, draft group places, sessions, login methods, devices,
// notifications, pair links, partner search). If a pair of theirs got into a
// published group in the meantime it stays, and the account's delete fails
// on its foreign key, so the whole batch rolls back.
async function remove(userId: string, email: string): Promise<boolean> {
  const theirPairs = db
    .select({ id: pairs.id })
    .from(pairs)
    .where(or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)));
  try {
    await db.batch([
      // A draft that loses a pair has changed: a publish running now sees it.
      db
        .update(groups)
        .set({ revision: sql`${groups.revision} + 1` })
        .where(and(isNull(groups.publishedAt), sql`${groups.id} in (select group_id from group_pairs where pair_id in ${theirPairs})`)),
      db
        .delete(pairs)
        .where(
          and(
            or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)),
            sql`not exists (select 1 from group_pairs gp join groups g on g.id = gp.group_id
              where gp.pair_id = ${pairs.id} and g.published_at is not null)`,
          ),
        ),
      db.delete(users).where(eq(users.id, userId)),
      ...personalDataStatements(userId, email, sql`1`),
    ] as unknown as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  } catch (e) {
    if (/FOREIGN KEY/i.test(String(e))) return false;
    throw e;
  }
  return true;
}

// History: the account stays as "Törölt játékos" without contact data or a
// way to log in, and its active pairs are dissolved (their unplayed entries
// withdrawn, D19). The first statement only runs while no pair of theirs
// plays in a running phase; everything after it waits for it.
async function anonymize(actorId: string, userId: string, email: string, now: Date): Promise<boolean> {
  const active = await db
    .select({ id: pairs.id })
    .from(pairs)
    .where(and(eq(pairs.status, "active"), or(eq(pairs.playerA, userId), eq(pairs.playerB, userId))));
  const gone = sql`exists (select 1 from users where users.id = ${userId} and users.deleted_at is not null)`;
  const [updated] = await db.batch([
    db
      .update(users)
      .set({
        name: DELETED_NAME,
        email: anonymizedEmail(userId),
        imageUrl: null,
        phone: null,
        sex: null,
        consentAt: null,
        lastLoginAt: null,
        deletedAt: now,
      })
      .where(and(eq(users.id, userId), isNull(users.deletedAt), eq(users.platformRole, "player"), sql`not ${inPublishedGroup(userId, now)}`))
      .returning({ id: users.id }),
    ...active.flatMap((p) => dissolveStatements(actorId, p.id, now, gone)),
    ...personalDataStatements(userId, email, gone),
  ]);
  return updated.length > 0;
}

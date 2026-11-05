import { and, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL, type SQLWrapper } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import {
  accountInvites,
  auditLog,
  emailMessages,
  emailSuppressions,
  groups,
  interestSignups,
  leagueAdminInvites,
  leagueAdmins,
  loginCodes,
  notificationOptOuts,
  groupPairs,
  notifications,
  oauthAccounts,
  pairInvites,
  pairLinks,
  pairs,
  partnerSearches,
  pushSubscriptions,
  sessions,
  stuckReminderPeople,
  users,
} from "~/db/schema";
import { partnerNoticeSubject } from "~/lib/email/templates";
import { auditIfChanged } from "~/lib/audit.server";
import { dissolveStatements } from "~/lib/pairs.server";
import { clearStrikeReasons } from "~/lib/strikes.server";

import {
  anonymizedEmail,
  DELETED_NAME,
  DELETION_REFUSALS,
  deletionPlan,
  mailNamesPerson,
  PARTNER_NOTICE_SUBJECT_REMOVED,
  type DeletionMode,
  type DeletionPlan,
} from "./account-deletion";

// Deleting an account in D1 (#152). The rules are in account-deletion.ts.
// Each deletion is one batch (a transaction in D1), so it happens whole or
// not at all. No email goes out to anyone.

export type DeletionFacts = { history: Set<string>; playing: Set<string> };

const CHANGED = "Közben változott valami. Frissítsd az oldalt, és próbáld újra.";

// A pair of the user `u` is in a published group (history, also after a
// withdrawal); with `now`, one whose phase hasn't reached its deadline yet
// and that the pair wasn't withdrawn from (#34).
function inPublishedGroup(u: SQLWrapper | string, now?: Date) {
  const running = now
    ? sql`and gp.withdrawn_at is null and exists (select 1 from season_phases sp where sp.season_id = g.season_id and sp.number = g.phase
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

type Target = { id: string; email: string; name: string; platformRole: "player" | "superadmin" };

async function target(userId: string): Promise<Target | undefined> {
  const [row] = await db
    .select({ id: users.id, email: users.email, name: users.name, platformRole: users.platformRole })
    .from(users)
    .where(and(eq(users.id, userId), isNull(users.deletedAt)));
  return row;
}

export async function planDeletion(actorId: string, userId: string, now = new Date()): Promise<DeletionPlan> {
  const [row, facts] = await Promise.all([target(userId), deletionFacts(now)]);
  return deletionPlan({ actorId, target: row ?? null, history: facts.history.has(userId), playing: facts.playing.has(userId) });
}

const lower = (column: SQLWrapper) => sql`lower(${column})`;

// What finds the stored mail to other people that names the deleted person
// (review of #152): the partner notices their own pair signups sent (the
// subject has their name), and the unsent mail whose text has their address
// or, in a kind that names other people, their name (mailNamesPerson).
type MailContext = { notices: { to: string; subject: string }[]; unsentIds: number[] };

async function mailContext(email: string, name: string): Promise<MailContext> {
  const [signups, unsent] = await Promise.all([
    db
      .select({ name1: interestSignups.name1, email2: interestSignups.email2 })
      .from(interestSignups)
      .where(and(eq(lower(interestSignups.email1), email), eq(interestSignups.mode, "pair"), isNotNull(interestSignups.email2))),
    // Pending, sending or failed: few rows (mail goes out at once, #112).
    db
      .select({ id: emailMessages.id, kind: emailMessages.kind, text: emailMessages.text })
      .from(emailMessages)
      .where(ne(emailMessages.status, "sent")),
  ]);
  return {
    notices: signups.map((s) => ({ to: s.email2!.toLowerCase(), subject: partnerNoticeSubject(s.name1) })),
    unsentIds: unsent.filter((m) => mailNamesPerson(m, { email, name })).map((m) => m.id),
  };
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Stored mail to other people that names the deleted person. A sent mail
// keeps only its subject (the body is cleared on sending), and only the
// partner notice's subject names someone, so it is rewritten. An unsent one
// is deleted, as the signup, partner or opponent it is about is gone.
function otherPeoplesMail(mail: MailContext, mine: (c: SQL | undefined) => SQL | undefined) {
  const notice = (n: MailContext["notices"][number]) =>
    and(eq(emailMessages.kind, "partner_notice"), eq(lower(emailMessages.toEmail), n.to), eq(emailMessages.subject, n.subject));
  return [
    ...mail.notices.flatMap((n) => [
      db.delete(emailMessages).where(mine(and(notice(n), ne(emailMessages.status, "sent")))),
      db.update(emailMessages).set({ subject: PARTNER_NOTICE_SUBJECT_REMOVED }).where(mine(notice(n))),
    ]),
    // Still unsent by the time the batch runs (D1: at most 100 bound
    // parameters per statement).
    ...chunks(mail.unsentIds, 90).map((ids) =>
      db.delete(emailMessages).where(mine(and(inArray(emailMessages.id, ids), ne(emailMessages.status, "sent")))),
    ),
  ];
}

// Everything personal tied to the account or its address, other than the
// users row and the pairs. `guard`: a condition every statement waits for
// (on anonymize: that the users row was anonymized in the same batch).
// The address's unsubscribe, bounce and complaint (email_suppressions) go
// too, so a later sign-up with it starts clean (#193).
function personalDataStatements(userId: string, email: string, mail: MailContext, guard: SQL) {
  const mine = (c: SQL | undefined) => and(c, guard);
  return [
    ...otherPeoplesMail(mail, mine),
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
    // Who got a stuck reminder this season (#191), by address.
    db.delete(stuckReminderPeople).where(mine(eq(stuckReminderPeople.email, email))),
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
    db.delete(emailSuppressions).where(mine(eq(lower(emailSuppressions.email), email))),
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
  const mail = await mailContext(email, row.name);
  // Both write their audit entries in their batch (#225): who and when only,
  // no name or email of the deleted person; the pairs an anonymize
  // dissolved are logged as any dissolve.
  const done = plan.mode === "remove" ? await remove(actorId, userId, email, mail) : await anonymize(actorId, userId, email, mail, now);
  if (!done) {
    // Something changed since the check: say why from the state now.
    const again = await planDeletion(actorId, userId, now);
    return { ok: false, error: again.ok ? CHANGED : DELETION_REFUSALS[again.refusal] };
  }
  return { ok: true, mode: plan.mode };
}

// No history: the pairs (none was ever in a published group, checked in the
// statement) and the account itself, with every row that cascades from
// them (entries, draft group places, sessions, login methods, devices,
// notifications, pair links, partner search). If a pair of theirs got into a
// published group in the meantime it stays, and the account's delete fails
// on its foreign key, so the whole batch rolls back.
async function remove(actorId: string, userId: string, email: string, mail: MailContext): Promise<boolean> {
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
      auditIfChanged({ actorId, action: "account.delete", target: `user:${userId}` }),
      ...personalDataStatements(userId, email, mail, sql`1`),
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
// plays in a running phase; everything after it waits for it. Returns the
// pairs it dissolved, or false when nothing changed.
// A mid-phase withdrawal's reason (#34) is free text that may be about the
// person's health: anonymizing takes it off their pairs' group rows and out
// of the partner's notice of it (the notice ends "Indok: <reason>"). The
// notice goes first, while the reason is still there to find it by.
function withdrawalReasonStatements(userId: string, guard: SQL) {
  const theirPairs = db
    .select({ id: pairs.id })
    .from(pairs)
    .where(or(eq(pairs.playerA, userId), eq(pairs.playerB, userId)));
  return [
    db
      .update(notifications)
      .set({ body: sql`substr(${notifications.body}, 1, instr(${notifications.body}, ' Indok: ') - 1)` })
      .where(
        and(
          eq(notifications.kind, "pair_withdrawn"),
          sql`instr(${notifications.body}, ' Indok: ') > 0`,
          // Only the pair's own players got the reason, and only at the end
          // of the notice: an exact suffix match, no LIKE wildcards.
          sql`exists (select 1 from group_pairs gp join pairs p on p.id = gp.pair_id
            where (p.player_a = ${userId} or p.player_b = ${userId}) and gp.withdrawal_reason is not null
            and ${notifications.userId} in (p.player_a, p.player_b)
            and substr(${notifications.body}, -length(' Indok: ' || gp.withdrawal_reason)) = ' Indok: ' || gp.withdrawal_reason)`,
          guard,
        ),
      ),
    db
      .update(groupPairs)
      .set({ withdrawalReason: null })
      .where(and(isNotNull(groupPairs.withdrawalReason), inArray(groupPairs.pairId, theirPairs), guard)),
  ];
}

async function anonymize(
  actorId: string,
  userId: string,
  email: string,
  mail: MailContext,
  now: Date,
): Promise<{ id: number; leagueId: number }[] | false> {
  const active = await db
    .select({ id: pairs.id, leagueId: pairs.leagueId })
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
    auditIfChanged({ actorId, action: "account.anonymize", target: `user:${userId}` }),
    ...active.flatMap((p) => dissolveStatements(actorId, p.id, now, gone, { leagueId: p.leagueId, detail: "account deleted" })),
    ...personalDataStatements(userId, email, mail, gone),
    ...withdrawalReasonStatements(userId, gone),
    ...clearStrikeReasons(userId, gone),
  ]);
  return updated.length > 0 ? active : false;
}

import { env } from "cloudflare:workers";
import { and, asc, count, eq, gt, inArray, isNull, lt, lte, notInArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { db } from "~/db/client.server";
import { accountInvites, broadcasts, emailMessages, emailSuppressions, interestSignups, leagues, users } from "~/db/schema";
import type { InterestSignup } from "~/lib/interest";

import { INTEREST_INVITE_NOTE, inviteRecipients, type Recipient } from "./audience";
import { BULK_KINDS, parseDailyLimit, sendBudget, type MessageKind } from "./budget";
import { hideAddresses, queuedStatus } from "./hold";
import { MAX_BATCH, sendBatch } from "./resend.server";
import { SITE_URL } from "~/lib/site";
import { CODE_TTL_MS } from "~/lib/auth/rules";
import { listCities } from "~/lib/cities.server";

import {
  broadcastEmail,
  groupsPublished,
  loginCode,
  pairAnswer,
  pairDissolved,
  pairIntro,
  pairInvite,
  partnerNotice,
  registrationInvite,
  seasonEntryDecision,
  signupConfirmation,
  type Email,
  type PairIntroPerson,
} from "./templates";
import { unsubscribeHeaders, unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

// The outbox: every email is first stored in email_messages, then delivered
// by deliver(), right away and again by the hourly cron (workers/app.ts).
// deliver() stays under the provider's daily quota; whatever doesn't fit
// waits for the next run. Only login codes and signup confirmations are
// stored ready to send; every other email is stored "held" and waits until
// an Admin sends (releaseHeld) or discards it (discardHeld) on /admin/outbox
// (#88, hold.ts).

const MAX_ATTEMPTS = 5;
// A run that crashed mid-send leaves rows in "sending"; retry them after this.
const STALE_CLAIM_MS = 10 * 60 * 1000;
// Keeps one run well inside the Workers subrequest limit.
const MAX_BATCHES_PER_RUN = 5;
// D1 allows 100 bound parameters per statement; a message row binds 7.
const INSERT_CHUNK = 10;

type NewMessage = Email & {
  kind: MessageKind;
  toEmail: string;
  broadcastId?: number;
  headers?: Record<string, string>;
};

export function dailyLimit(): number {
  return parseDailyLimit(env.EMAIL_DAILY_LIMIT);
}

export function emailSecret(): string {
  if (env.EMAIL_SECRET) return env.EMAIL_SECRET;
  if (import.meta.env.DEV) return "dev-secret";
  throw new Error("EMAIL_SECRET is not set");
}

function messageValues(m: NewMessage) {
  return {
    kind: m.kind,
    status: queuedStatus(m.kind),
    broadcastId: m.broadcastId ?? null,
    toEmail: m.toEmail,
    subject: m.subject,
    html: m.html,
    text: m.text,
    headers: m.headers ? JSON.stringify(m.headers) : null,
  };
}

async function enqueue(messages: NewMessage[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < messages.length; i += INSERT_CHUNK) {
    const rows = await db
      .insert(emailMessages)
      .values(messages.slice(i, i + INSERT_CHUNK).map(messageValues))
      .returning({ id: emailMessages.id });
    ids.push(...rows.map((r) => r.id));
  }
  return ids;
}

export async function suppressedSet(): Promise<Set<string>> {
  const rows = await db.select({ email: emailSuppressions.email }).from(emailSuppressions);
  return new Set(rows.map((r) => r.email));
}

async function isSuppressed(email: string): Promise<boolean> {
  const [row] = await db
    .select({ email: emailSuppressions.email })
    .from(emailSuppressions)
    .where(eq(emailSuppressions.email, email.toLowerCase()));
  return !!row;
}

export async function suppress(email: string, reason: "unsubscribed" | "bounced" | "complained") {
  await db.insert(emailSuppressions).values({ email: email.toLowerCase(), reason }).onConflictDoNothing();
}

// At most one signup confirmation per address per day, so the signup form
// can't be used to flood someone's inbox.
const CONFIRMATION_INTERVAL_MS = 24 * 60 * 60 * 1000;

// Signup confirmation, plus the one-time partner notice (spec section 17).
export async function queueSignupEmails(signup: InterestSignup, now = new Date()): Promise<number[]> {
  const cities = await listCities();
  const [confirmed] = await db
    .select({ n: count() })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.kind, "signup_confirmation"),
        eq(emailMessages.toEmail, signup.email1),
        gt(emailMessages.createdAt, new Date(now.getTime() - CONFIRMATION_INTERVAL_MS)),
      ),
    );
  const messages: NewMessage[] =
    confirmed.n === 0
      ? [{ kind: "signup_confirmation", toEmail: signup.email1, ...signupConfirmation(signup, cities) }]
      : [];
  if (signup.mode === "pair" && signup.name2 && signup.email2) {
    const partner = signup.email2.toLowerCase();
    const [[notified], [suppressed]] = await Promise.all([
      db
        .select({ n: count() })
        .from(emailMessages)
        .where(and(eq(emailMessages.kind, "partner_notice"), eq(emailMessages.toEmail, partner))),
      db.select({ n: count() }).from(emailSuppressions).where(eq(emailSuppressions.email, partner)),
    ]);
    if (notified.n === 0 && suppressed.n === 0)
      messages.push({ kind: "partner_notice", toEmail: partner, ...partnerNotice(signup, cities) });
  }
  return enqueue(messages);
}

// Two solo signups a Szervező paired: each gets the other's name and email.
// An unsubscribed address gets nothing.
export async function queuePairIntros(a: PairIntroPerson, b: PairIntroPerson, city: string): Promise<number[]> {
  const suppressed = await suppressedSet();
  const messages: NewMessage[] = [
    [a, b],
    [b, a],
  ]
    .filter(([to]) => !suppressed.has(to.email.toLowerCase()))
    .map(([to, partner]) => ({ kind: "pair_intro", toEmail: to.email, ...pairIntro(to, partner, city) }));
  return enqueue(messages);
}

// A login code goes out at once, ahead of broadcasts (transactional budget).
// If the provider is down it stays queued like any email, but by the next
// cron run the code has expired; the person just asks for a new one.
export async function queueLoginCode(email: string, code: string): Promise<void> {
  const ids = await enqueue([
    { kind: "login_code", toEmail: email, ...loginCode(code, CODE_TTL_MS / 60_000) },
  ]);
  await deliver(ids);
}

// Partner invite emails one address gets in 24 hours, from anyone: several
// players can't use invites to flood an inbox.
const PAIR_INVITES_PER_ADDRESS_PER_DAY = 3;

// A partner invite (#21), held for the Admin like every email but login codes
// and signup confirmations (#88). It goes to an address another player
// typed, so it has an unsubscribe link. An unsubscribed or bounced address,
// or one over the daily cap, gets nothing; the invite still shows in the app
// once they log in.
export async function queuePairInvite(
  toEmail: string,
  input: { inviterName: string; league: string; link: string; hasAccount: boolean },
  now = new Date(),
): Promise<void> {
  if (await isSuppressed(toEmail)) return;
  const [recent] = await db
    .select({ n: count() })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.kind, "pair_invite"),
        eq(emailMessages.toEmail, toEmail),
        gt(emailMessages.createdAt, new Date(now.getTime() - 24 * 60 * 60 * 1000)),
      ),
    );
  if (recent.n >= PAIR_INVITES_PER_ADDRESS_PER_DAY) return;
  const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(toEmail, emailSecret()));
  await deliver(
    await enqueue([{ kind: "pair_invite", toEmail, headers: unsubscribeHeaders(url), ...pairInvite(input, url) }]),
  );
}

// The inviter learns whether the invite was accepted or declined (#21).
export async function queuePairAnswer(
  toEmail: string,
  input: { to: string; inviteeName: string; league: string; accepted: boolean },
): Promise<void> {
  if (await isSuppressed(toEmail)) return;
  await deliver(await enqueue([{ kind: "pair_answer", toEmail, ...pairAnswer(input) }]));
}

// The partner learns the pair was dissolved (#85). An unsubscribed or bounced
// address gets nothing, like the other pair emails.
export async function queuePairDissolved(
  toEmail: string,
  input: { to: string; dissolverName: string; league: string },
): Promise<void> {
  if (await isSuppressed(toEmail)) return;
  await deliver(await enqueue([{ kind: "pair_dissolved", toEmail, ...pairDissolved(input) }]));
}

// A Szervező approved or rejected a season entry (#23): each player of the
// pair gets one. An unsubscribed or bounced address gets nothing; the status
// still shows in the app.
export async function queueSeasonEntryDecision(
  toEmail: string,
  input: Parameters<typeof seasonEntryDecision>[0],
): Promise<void> {
  if (await isSuppressed(toEmail)) return;
  await deliver(await enqueue([{ kind: "season_entry_decision", toEmail, ...seasonEntryDecision(input) }]));
}

// The groups are published (#24, D22): one email per player, held until the
// Admin sends it (#88), then sent as transactional mail (ahead of
// broadcasts); what doesn't fit the day's quota goes with the next cron runs.
// Unsubscribed or bounced addresses get nothing; the groups still show in the
// app.
export async function queueGroupsPublished(
  messages: { toEmail: string; input: Parameters<typeof groupsPublished>[0] }[],
): Promise<void> {
  const suppressed = await suppressedSet();
  const queued = messages
    .filter((m) => !suppressed.has(m.toEmail.toLowerCase()))
    .map((m): NewMessage => ({ kind: "groups_published", toEmail: m.toEmail, ...groupsPublished(m.input) }));
  const ids = await enqueue(queued);
  // deliver() binds every id it is given: a few at a time keeps each
  // statement under D1's 100 parameters.
  for (let i = 0; i < ids.length; i += DELIVER_CHUNK) await deliver(ids.slice(i, i + DELIVER_CHUNK));
}

const DELIVER_CHUNK = 50;

export async function createBroadcast(input: {
  subject: string;
  body: string;
  audience: string;
  recipients: Recipient[];
  createdBy: string;
}): Promise<number> {
  const [{ id }] = await db
    .insert(broadcasts)
    .values({
      subject: input.subject,
      body: input.body,
      audience: input.audience,
      recipients: input.recipients.length,
      createdBy: input.createdBy,
    })
    .returning({ id: broadcasts.id });

  const secret = emailSecret();
  const messages = await Promise.all(
    input.recipients.map(async (r): Promise<NewMessage> => {
      const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(r.email, secret));
      return {
        kind: "broadcast",
        broadcastId: id,
        toEmail: r.email,
        headers: unsubscribeHeaders(url),
        ...broadcastEmail(input, r, url),
      };
    }),
  );
  await enqueue(messages);
  return id;
}

// Who would get the registration invite now (#20, audience.ts inviteRecipients).
export async function pendingRegistrationInvites(): Promise<Recipient[]> {
  const [rows, leagueCities, accounts, suppressed] = await Promise.all([
    db
      .select({
        id: interestSignups.id,
        mode: interestSignups.mode,
        email1: interestSignups.email1,
        name1: interestSignups.name1,
        email2: interestSignups.email2,
        name2: interestSignups.name2,
        pairedWith: interestSignups.pairedWith,
        city: interestSignups.city,
        status: interestSignups.status,
        createdAt: interestSignups.createdAt,
        invitedAt: interestSignups.invitedAt,
        invited2At: interestSignups.invited2At,
      })
      .from(interestSignups)
      .orderBy(asc(interestSignups.id)),
    db.selectDistinct({ city: leagues.city }).from(leagues),
    db.select({ email: users.email }).from(users),
    suppressedSet(),
  ]);
  return inviteRecipients(rows, {
    leagueCities: new Set(leagueCities.map((l) => l.city)),
    accounts: new Set(accounts.map((u) => u.email.toLowerCase())),
    suppressed,
  });
}

// account_invites binds 3 parameters per row, the invited_at update 1 per
// address plus the timestamp (D1: at most 100 per statement).
const INVITE_CHUNK = 30;
const MARK_CHUNK = 90;

// Sets or clears invited_at on every signup row of these addresses (and
// invited2_at where the address is the partner, email2). Setting only touches
// rows not invited yet, and returns the addresses it claimed.
async function markInvited(emails: string[], invitedAt: Date | null): Promise<Set<string>> {
  const claimed = new Set<string>();
  for (let i = 0; i < emails.length; i += MARK_CHUNK) {
    const slice = emails.slice(i, i + MARK_CHUNK);
    const chunk1 = inArray(sql`lower(${interestSignups.email1})`, slice);
    const chunk2 = inArray(sql`lower(${interestSignups.email2})`, slice);
    const [rows1, rows2] = await db.batch([
      db
        .update(interestSignups)
        .set({ invitedAt })
        .where(invitedAt ? and(chunk1, isNull(interestSignups.invitedAt)) : chunk1)
        .returning({ email: interestSignups.email1 }),
      db
        .update(interestSignups)
        .set({ invited2At: invitedAt })
        .where(invitedAt ? and(chunk2, isNull(interestSignups.invited2At)) : chunk2)
        .returning({ email: interestSignups.email2 }),
    ]);
    for (const r of [...rows1, ...rows2]) if (r.email) claimed.add(r.email.toLowerCase());
  }
  return claimed;
}

// Queues the registration invite for everyone pending. The addresses are
// claimed first (invited_at), so a second send running at the same time gets
// none of them and nobody is invited twice. Then, in one D1 batch (a
// transaction): the emails and the account_invites rows (so the link works
// before registration opens). If that fails, the claim is released. Returns
// how many were queued.
export async function queueRegistrationInvites(now = new Date()): Promise<number> {
  const pending = await pendingRegistrationInvites();
  if (pending.length === 0) return 0;
  const claimed = await markInvited(
    pending.map((r) => r.email),
    now,
  );
  const recipients = pending.filter((r) => claimed.has(r.email));
  if (recipients.length === 0) return 0;
  const emails = recipients.map((r) => r.email);
  try {
    const secret = emailSecret();
    const messages = await Promise.all(
      recipients.map(async (r): Promise<NewMessage> => {
        const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(r.email, secret));
        return { kind: "registration_invite", toEmail: r.email, headers: unsubscribeHeaders(url), ...registrationInvite(r, url) };
      }),
    );
    const statements: BatchItem<"sqlite">[] = [];
    for (let i = 0; i < messages.length; i += INSERT_CHUNK)
      statements.push(db.insert(emailMessages).values(messages.slice(i, i + INSERT_CHUNK).map(messageValues)));
    for (let i = 0; i < emails.length; i += INVITE_CHUNK)
      statements.push(
        db
          .insert(accountInvites)
          .values(emails.slice(i, i + INVITE_CHUNK).map((email) => ({ email, note: INTEREST_INVITE_NOTE })))
          .onConflictDoNothing(),
      );
    const [first, ...rest] = statements;
    await db.batch([first, ...rest]);
  } catch (e) {
    await markInvited(emails, null);
    throw e;
  }
  return recipients.length;
}

// A one-off test of a draft, sent only to the admin. Not stored.
export async function sendTestBroadcast(draft: { subject: string; body: string }, to: Recipient) {
  const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(to.email, emailSecret()));
  const email = broadcastEmail(draft, to, url);
  return sendBatch([{ to: to.email, ...email, subject: `[TESZT] ${email.subject}` }]);
}

type Claimed = typeof emailMessages.$inferSelect;

// The send order: login codes, other transactional emails, then bulk mail
// (broadcasts and registration invites). Each group has its own budget
// (budget.ts).
const GROUPS = ["login", "transactional", "broadcast"] as const;
type Group = (typeof GROUPS)[number];
const GROUP_BUDGET_KIND: Record<Group, MessageKind> = {
  login: "login_code",
  transactional: "signup_confirmation",
  broadcast: "broadcast",
};

async function claim(limit: number, group: Group, ids?: number[]): Promise<Claimed[]> {
  if (limit <= 0) return [];
  const pending = db
    .select({ id: emailMessages.id })
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.status, "pending"),
        group === "transactional"
          ? notInArray(emailMessages.kind, [...BULK_KINDS, "login_code"])
          : group === "broadcast"
            ? inArray(emailMessages.kind, [...BULK_KINDS])
            : eq(emailMessages.kind, GROUP_BUDGET_KIND[group]),
        ids ? inArray(emailMessages.id, ids) : undefined,
      ),
    )
    .orderBy(asc(emailMessages.id))
    .limit(Math.min(limit, MAX_BATCH));
  // One UPDATE ... RETURNING, so two concurrent runs can't claim the same row.
  return db
    .update(emailMessages)
    .set({ status: "sending", claimedAt: new Date() })
    .where(and(eq(emailMessages.status, "pending"), inArray(emailMessages.id, pending)))
    .returning();
}

async function sendClaimed(rows: Claimed[]): Promise<"ok" | "stop"> {
  const result = await sendBatch(
    rows.map((r) => ({
      to: r.toEmail,
      subject: r.subject,
      html: r.html ?? "",
      text: r.text ?? "",
      headers: r.headers ? (JSON.parse(r.headers) as Record<string, string>) : undefined,
    })),
  );
  const ids = rows.map((r) => r.id);

  if (result.ok) {
    const now = new Date();
    const [first, ...rest] = rows.map((r, i) =>
      db
        .update(emailMessages)
        .set({ status: "sent", sentAt: now, providerId: result.ids[i] ?? null, html: null, text: null, lastError: null })
        .where(eq(emailMessages.id, r.id)),
    );
    await db.batch([first, ...rest]);
    return "ok";
  }

  console.error("email batch failed", result.error);
  if (result.retryLater) {
    await db.update(emailMessages).set({ status: "pending", lastError: result.error }).where(inArray(emailMessages.id, ids));
    return "stop";
  }
  await db
    .update(emailMessages)
    .set({
      attempts: sql`${emailMessages.attempts} + 1`,
      status: sql`case when ${emailMessages.attempts} + 1 >= ${MAX_ATTEMPTS} then 'failed' else 'pending' end`,
      lastError: result.error,
    })
    .where(inArray(emailMessages.id, ids));
  return "stop";
}

// Sends pending emails within the daily budget: login codes first, then
// signup emails, then broadcasts. With `ids`, only those messages (used right after a signup).
export async function deliver(ids?: number[]): Promise<{ sent: number }> {
  const now = Date.now();
  await db
    .update(emailMessages)
    .set({ status: "pending" })
    .where(and(eq(emailMessages.status, "sending"), lt(emailMessages.claimedAt, new Date(now - STALE_CLAIM_MS))));

  const [{ n: sentLast24h }] = await db
    .select({ n: count() })
    .from(emailMessages)
    .where(gt(emailMessages.sentAt, new Date(now - 24 * 60 * 60 * 1000)));

  const limit = dailyLimit();
  let sent = 0;
  for (const group of GROUPS) {
    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const budget = sendBudget(limit, sentLast24h + sent, GROUP_BUDGET_KIND[group]);
      const rows = await claim(budget, group, ids);
      if (rows.length === 0) break;
      if ((await sendClaimed(rows)) === "stop") return { sent };
      sent += rows.length;
    }
  }
  return { sent };
}

export type BroadcastSummary = typeof broadcasts.$inferSelect & {
  // Waiting on /admin/outbox (#88).
  held: number;
  sent: number;
  pending: number;
  failed: number;
};

export async function listBroadcasts(): Promise<BroadcastSummary[]> {
  const [list, stats] = await Promise.all([
    db.select().from(broadcasts).orderBy(sql`${broadcasts.id} desc`),
    db
      .select({ broadcastId: emailMessages.broadcastId, status: emailMessages.status, n: count() })
      .from(emailMessages)
      .where(eq(emailMessages.kind, "broadcast"))
      .groupBy(emailMessages.broadcastId, emailMessages.status),
  ]);
  return list.map((b) => {
    const of = (s: string) => stats.filter((x) => x.broadcastId === b.id && x.status === s).reduce((a, x) => a + x.n, 0);
    return { ...b, held: of("held"), sent: of("sent"), pending: of("pending") + of("sending"), failed: of("failed") };
  });
}

// --- Held mail (/admin/outbox, #88) -----------------------------------------

export type HeldKind = {
  kind: MessageKind;
  count: number;
  // The newest held id the page saw: sending or discarding stops there, so
  // mail held after the page loaded isn't included without being counted.
  upTo: number;
  // The oldest held email of the kind, with every address hidden.
  subject: string;
  text: string;
};

// Held mail, one entry per kind, oldest kind first. No recipient.
export async function listHeld(): Promise<HeldKind[]> {
  const groups = await db
    .select({
      kind: emailMessages.kind,
      n: count(),
      first: sql<number>`min(${emailMessages.id})`,
      last: sql<number>`max(${emailMessages.id})`,
    })
    .from(emailMessages)
    .where(eq(emailMessages.status, "held"))
    .groupBy(emailMessages.kind)
    .orderBy(sql`min(${emailMessages.id})`);
  if (groups.length === 0) return [];
  const previews = await db
    .select({ id: emailMessages.id, subject: emailMessages.subject, text: emailMessages.text })
    .from(emailMessages)
    .where(inArray(emailMessages.id, groups.map((g) => g.first)));
  return groups.map((g) => {
    const p = previews.find((x) => x.id === g.first);
    return {
      kind: g.kind,
      count: g.n,
      upTo: g.last,
      subject: hideAddresses(p?.subject ?? ""),
      text: hideAddresses(p?.text ?? ""),
    };
  });
}

const heldOfKind = (kind: MessageKind, upTo: number) =>
  and(eq(emailMessages.status, "held"), eq(emailMessages.kind, kind), lte(emailMessages.id, upTo));

// "Küldés": the kind's held mail joins the normal queue, where deliver()
// keeps the daily quota and the send order. Mail to an address that
// unsubscribed, bounced or complained while it was held is deleted instead,
// as if it had never been queued. One D1 batch (a transaction).
export async function releaseHeld(kind: MessageKind, upTo: number): Promise<{ released: number; skipped: number }> {
  const suppressed = db.select({ email: emailSuppressions.email }).from(emailSuppressions);
  const [skipped, released] = await db.batch([
    db
      .delete(emailMessages)
      .where(and(heldOfKind(kind, upTo), inArray(sql`lower(${emailMessages.toEmail})`, suppressed)))
      .returning({ id: emailMessages.id }),
    db.update(emailMessages).set({ status: "pending" }).where(heldOfKind(kind, upTo)).returning({ id: emailMessages.id }),
  ]);
  return { released: released.length, skipped: skipped.length };
}

// "Elvetés": the kind's held mail is deleted unsent. Discarded registration
// invites also lose their invited mark (invited_at, or invited2_at for a
// partner's address), so the invite button offers those addresses again;
// their account_invites rows stay. Returns how many.
export async function discardHeld(kind: MessageKind, upTo: number): Promise<number> {
  const rows = await db
    .delete(emailMessages)
    .where(heldOfKind(kind, upTo))
    .returning({ toEmail: emailMessages.toEmail });
  if (kind === "registration_invite" && rows.length > 0)
    await markInvited(
      rows.map((r) => r.toEmail.toLowerCase()),
      null,
    );
  return rows.length;
}

// Deletion request: remove the stored emails sent to these addresses.
export async function deleteMessagesTo(emails: string[]) {
  if (emails.length === 0) return;
  await db.delete(emailMessages).where(inArray(emailMessages.toEmail, emails.map((e) => e.toLowerCase())));
}

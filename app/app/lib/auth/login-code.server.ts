import { and, count, eq, gt, inArray, lt, lte, notInArray, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { accountInvites, emailMessages, emailSuppressions, loginCodes, users } from "~/db/schema";
import { isAnonymizedEmail } from "~/lib/account-deletion";
import { dailyLimit, queueLoginCode } from "~/lib/email/outbox.server";

import { createUser, findUserIdByEmail } from "./accounts.server";
import {
  checkCode,
  CODE_MESSAGES,
  CODE_TTL_MS,
  codeSendDecision,
  isValidEmail,
  MAX_CODE_ATTEMPTS,
  newAddressCodeDecision,
  normalizeCode,
  normalizeEmail,
  staleCodeCutoffs,
} from "./rules";
import { generateCode, sha256Hex, timingSafeEqual } from "./tokens";
import { logInfo, logWarn } from "~/lib/log";

// The email is part of the hash, so the same code for two addresses hashes
// differently.
function codeHash(email: string, code: string): Promise<string> {
  return sha256Hex(`${email}:${code}`);
}

export type SendResult = { ok: true; email: string } | { ok: false; error: string };

const DAY_MS = 24 * 60 * 60 * 1000;

// Whether a code may go to this address (rules.ts newAddressCodeDecision):
// always for an account; for a new address not when it bounced or complained,
// nor past the daily cap for new, uninvited addresses.
async function mayEmailCode(email: string, now: Date): Promise<boolean> {
  if (await findUserIdByEmail(email)) return true;
  const [[invite], [suppression], [{ n: sentToNewLast24h }]] = await Promise.all([
    db.select({ email: accountInvites.email }).from(accountInvites).where(eq(accountInvites.email, email)),
    db.select({ reason: emailSuppressions.reason }).from(emailSuppressions).where(eq(emailSuppressions.email, email)),
    db
      .select({ n: count() })
      .from(emailMessages)
      .where(
        and(
          eq(emailMessages.kind, "login_code"),
          gt(emailMessages.createdAt, new Date(now.getTime() - DAY_MS)),
          notInArray(emailMessages.toEmail, db.select({ email: users.email }).from(users)),
          notInArray(emailMessages.toEmail, db.select({ email: accountInvites.email }).from(accountInvites)),
        ),
      ),
  ]);
  const decision = newAddressCodeDecision({
    hasAccount: false,
    invited: !!invite,
    suppression: suppression?.reason ?? null,
    sentToNewLast24h,
    dailyLimit: dailyLimit(),
  });
  if (decision === "capped") logWarn("login code skipped", { reason: "daily cap for new addresses reached" });
  return decision === "send";
}

export async function sendLoginCode(input: string): Promise<SendResult> {
  const email = normalizeEmail(input);
  if (!isValidEmail(email)) return codeRequest("invalid", { ok: false, error: "Ez nem tűnik e-mail-címnek." });
  // Any address may log in; a new one gets an account at its first login
  // (#113). The bot check (login route) and the code limits stay. No email and
  // no error when the address may not get one (mayEmailCode): an error would
  // tell anyone which addresses have an account. Such an address still gets a
  // code row (a code nobody knows) under the same limits, so a wrong code,
  // a locked code and "too many codes" read the same as for a sent one (#123).
  // A deleted account's placeholder address (#152) is never emailed either.
  const now = new Date();
  const mayEmail = !isAnonymizedEmail(email) && (await mayEmailCode(email, now));

  const [existing] = await db.select().from(loginCodes).where(eq(loginCodes.email, email));
  const decision = codeSendDecision(existing ?? null, now);
  if (!decision.ok) return codeRequest("rate limited", { ok: false, error: "Túl sok kódot kértél. Próbáld újra egy óra múlva." });

  const code = generateCode();
  const row = {
    codeHash: await codeHash(email, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    attempts: 0,
    windowStart: decision.windowStart,
    sentInWindow: decision.sentInWindow,
  };
  await db.insert(loginCodes).values({ email, ...row }).onConflictDoUpdate({ target: loginCodes.email, set: row });
  if (mayEmail) await queueLoginCode(email, code);
  return codeRequest(mayEmail ? "sent" : "withheld", { ok: true, email });
}

export type VerifyResult = { ok: true; userId: string } | { ok: false; error: string };

export async function verifyLoginCode(emailInput: string, codeInput: string): Promise<VerifyResult> {
  const email = normalizeEmail(emailInput);
  const code = normalizeCode(codeInput);
  if (!code) return attempt("invalid", { ok: false, error: "A kód 6 számjegy." });

  // Uses up an attempt before comparing, in one statement: parallel guesses
  // each take their own attempt, so no more than MAX_CODE_ATTEMPTS get checked.
  const now = new Date();
  const [record] = await db
    .update(loginCodes)
    .set({ attempts: sql`${loginCodes.attempts} + 1` })
    .where(and(eq(loginCodes.email, email), lt(loginCodes.attempts, MAX_CODE_ATTEMPTS), gt(loginCodes.expiresAt, now)))
    .returning();
  if (!record) {
    // Locked, expired or missing: read the row again only for the message.
    const [row] = await db.select().from(loginCodes).where(eq(loginCodes.email, email));
    const result = checkCode(row ?? null, false, now);
    const reason = result === "ok" || result === "wrong" ? "missing" : result;
    return attempt(reason, { ok: false, error: CODE_MESSAGES[reason] });
  }
  // A deleted account's placeholder address (#152) never logs in, not even
  // with a guessed code: it reads as a wrong one.
  if (isAnonymizedEmail(email) || !timingSafeEqual(record.codeHash, await codeHash(email, code)))
    return attempt("wrong", { ok: false, error: CODE_MESSAGES.wrong });

  // Single use. Deleting by the hash we checked means a parallel request with
  // the same code can't also succeed.
  const deleted = await db
    .delete(loginCodes)
    .where(sql`${loginCodes.email} = ${email} and ${loginCodes.codeHash} = ${record.codeHash}`)
    .returning({ email: loginCodes.email });
  if (deleted.length === 0) return attempt("missing", { ok: false, error: CODE_MESSAGES.missing });

  const existing = await findUserIdByEmail(email);
  if (existing) return attempt("ok", { ok: true, userId: existing });
  return attempt("ok", { ok: true, userId: await createUser(email) }, true);
}

// Stale code records go (#168, rules.ts isStaleCode): the cron calls this
// every run, one query that deletes at most STALE_CODE_BATCH of them; a
// bigger backlog goes over the next runs (144 runs a day). Once caught up the
// table only holds the last hour or so of code requests. Returns how many went.
export const STALE_CODE_BATCH = 1000;

export async function deleteStaleLoginCodes(now: Date): Promise<number> {
  const { expiredBy, windowStartedBy } = staleCodeCutoffs(now);
  const stale = and(lte(loginCodes.expiresAt, expiredBy), lte(loginCodes.windowStart, windowStartedBy));
  const deleted = await db
    .delete(loginCodes)
    .where(and(stale, inArray(loginCodes.email, db.select({ email: loginCodes.email }).from(loginCodes).where(stale).limit(STALE_CODE_BATCH))))
    .returning({ email: loginCodes.email });
  return deleted.length;
}

// Login attempts in the log (#227): the outcome and, on success, the account
// id; never the address or the code.
function codeRequest(outcome: string, result: SendResult): SendResult {
  (result.ok ? logInfo : logWarn)("login code", { outcome });
  return result;
}

function attempt(outcome: string, result: VerifyResult, created = false): VerifyResult {
  if (result.ok) logInfo("login", { method: "code", outcome, userId: result.userId, created });
  else logWarn("login", { method: "code", outcome });
  return result;
}

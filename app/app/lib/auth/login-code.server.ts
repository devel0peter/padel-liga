import { and, eq, gt, lt, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { loginCodes } from "~/db/schema";
import { queueLoginCode } from "~/lib/email/outbox.server";

import { createUser, findUserIdByEmail, mayLogIn } from "./accounts.server";
import {
  checkCode,
  CODE_MESSAGES,
  CODE_TTL_MS,
  codeSendDecision,
  isValidEmail,
  MAX_CODE_ATTEMPTS,
  normalizeCode,
  normalizeEmail,
  REGISTRATION_CLOSED_MESSAGE,
} from "./rules";
import { generateCode, sha256Hex, timingSafeEqual } from "./tokens";

// The email is part of the hash, so the same code for two addresses hashes
// differently.
function codeHash(email: string, code: string): Promise<string> {
  return sha256Hex(`${email}:${code}`);
}

export type SendResult = { ok: true; email: string } | { ok: false; error: string };

export async function sendLoginCode(input: string): Promise<SendResult> {
  const email = normalizeEmail(input);
  if (!isValidEmail(email)) return { ok: false, error: "Ez nem tűnik e-mail-címnek." };
  // No code and no error for an address that can't log in yet: an error would
  // tell anyone which addresses have an account or an invite.
  if (!(await mayLogIn(email))) return { ok: true, email };

  const now = new Date();
  const [existing] = await db.select().from(loginCodes).where(eq(loginCodes.email, email));
  const decision = codeSendDecision(existing ?? null, now);
  if (!decision.ok) return { ok: false, error: "Túl sok kódot kértél. Próbáld újra egy óra múlva." };

  const code = generateCode();
  const row = {
    codeHash: await codeHash(email, code),
    expiresAt: new Date(now.getTime() + CODE_TTL_MS),
    attempts: 0,
    windowStart: decision.windowStart,
    sentInWindow: decision.sentInWindow,
  };
  await db.insert(loginCodes).values({ email, ...row }).onConflictDoUpdate({ target: loginCodes.email, set: row });
  await queueLoginCode(email, code);
  return { ok: true, email };
}

export type VerifyResult = { ok: true; userId: string } | { ok: false; error: string };

export async function verifyLoginCode(emailInput: string, codeInput: string): Promise<VerifyResult> {
  const email = normalizeEmail(emailInput);
  const code = normalizeCode(codeInput);
  if (!code) return { ok: false, error: "A kód 6 számjegy." };

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
    return { ok: false, error: CODE_MESSAGES[result === "ok" || result === "wrong" ? "missing" : result] };
  }
  if (!timingSafeEqual(record.codeHash, await codeHash(email, code))) return { ok: false, error: CODE_MESSAGES.wrong };

  // Single use. Deleting by the hash we checked means a parallel request with
  // the same code can't also succeed.
  const deleted = await db
    .delete(loginCodes)
    .where(sql`${loginCodes.email} = ${email} and ${loginCodes.codeHash} = ${record.codeHash}`)
    .returning({ email: loginCodes.email });
  if (deleted.length === 0) return { ok: false, error: CODE_MESSAGES.missing };

  const existing = await findUserIdByEmail(email);
  if (existing) return { ok: true, userId: existing };
  // Registration may have closed or the invite been removed since the code was sent.
  if (!(await mayLogIn(email))) return { ok: false, error: REGISTRATION_CLOSED_MESSAGE };
  return { ok: true, userId: await createUser(email) };
}

import { eq, sql } from "drizzle-orm";

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
  if (!(await mayLogIn(email))) return { ok: false, error: REGISTRATION_CLOSED_MESSAGE };

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

  const [record] = await db.select().from(loginCodes).where(eq(loginCodes.email, email));
  const matches = !!record && timingSafeEqual(record.codeHash, await codeHash(email, code));
  const result = checkCode(record ?? null, matches, new Date());
  if (result === "wrong") {
    await db
      .update(loginCodes)
      .set({ attempts: sql`${loginCodes.attempts} + 1` })
      .where(eq(loginCodes.email, email));
  }
  if (result !== "ok") return { ok: false, error: CODE_MESSAGES[result] };

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

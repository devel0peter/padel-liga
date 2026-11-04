import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { interestSignups } from "~/db/schema";
import { auditIfChanged, auditWhen } from "~/lib/audit.server";
import { deliver, queuePairIntros } from "~/lib/email/outbox.server";
import { pairIntroMessage } from "~/lib/notifications";
import { notifyAccounts } from "~/lib/notifications.server";

import { pairError } from "./solo-pairing";
import { logError } from "~/lib/log";

// Pairs two solo signups of the city and emails both (pairIntro). Returns an
// error message (Hungarian) instead when they can't be paired.
export async function pairSolos(
  actorId: string,
  leagueId: number,
  aId: number,
  bId: number,
  city: string,
  cityName: string,
): Promise<string | null> {
  const rows = await db.select().from(interestSignups).where(inArray(interestSignups.id, [aId, bId]));
  const a = rows.find((r) => r.id === aId);
  const b = rows.find((r) => r.id === bId);
  const error = pairError(a, b, city);
  if (error || !a || !b) return error;

  const now = new Date();
  // Only rows still unpaired: a second Szervező pairing one of them at the
  // same time changes nothing here.
  const pair = (id: number, partner: number) =>
    db
      .update(interestSignups)
      .set({ pairedWith: partner, status: "paired", updatedAt: now })
      .where(and(eq(interestSignups.id, id), isNull(interestSignups.pairedWith)))
      .returning({ id: interestSignups.id });
  // The audit entry only if both halves went through (#225).
  const both = sql`(select count(*) from ${interestSignups} where (${interestSignups.id} = ${a.id} and ${interestSignups.pairedWith} = ${b.id})
    or (${interestSignups.id} = ${b.id} and ${interestSignups.pairedWith} = ${a.id})) = 2`;
  const [first, second] = await db.batch([
    pair(a.id, b.id),
    pair(b.id, a.id),
    auditWhen(both, { actorId, action: "solo.pair", target: `signup:${a.id}`, detail: `signup:${b.id}`, leagueId }),
  ]);
  if (first.length === 0 || second.length === 0) {
    // Lost the race for one of them: undo our half.
    for (const [done, id, partner] of [[first, a.id, b.id], [second, b.id, a.id]] as const)
      if (done.length) await unpairRow(id, partner);
    return "Valamelyikük közben párt kapott.";
  }

  // The pair is saved; an email problem must not undo it. Anything not sent
  // now stays queued for the cron.
  try {
    await deliver(
      await queuePairIntros(
        { name: a.name1, email: a.email1, level: a.level },
        { name: b.name1, email: b.email1, level: b.level },
        cityName,
      ),
    );
  } catch (e) {
    logError("pair intro email failed", { error: e });
  }
  // In the app too, for whoever has an account (#115): the email skips an
  // account that switched email off.
  const message = pairIntroMessage(cityName);
  await notifyAccounts("pair_intro", [a.email1, b.email1].map((email) => ({ email, message })));
  return null;
}

function unpairStatement(id: number, partner: number) {
  return db
    .update(interestSignups)
    .set({ pairedWith: null, status: "new", updatedAt: new Date() })
    .where(and(eq(interestSignups.id, id), eq(interestSignups.pairedWith, partner)));
}

async function unpairRow(id: number, partner: number): Promise<void> {
  await unpairStatement(id, partner);
}

// Undoes a pairing (no email). Both go back to the waiting list, in one batch
// with the audit entry (#225).
export async function unpairSolo(actorId: string, leagueId: number, id: number, city: string): Promise<void> {
  const [row] = await db.select().from(interestSignups).where(eq(interestSignups.id, id));
  if (!row || row.city !== city || row.pairedWith == null) return;
  await db.batch([
    unpairStatement(row.id, row.pairedWith),
    auditIfChanged({ actorId, action: "solo.unpair", target: `signup:${row.id}`, detail: `signup:${row.pairedWith}`, leagueId }),
    unpairStatement(row.pairedWith, row.id),
  ]);
}

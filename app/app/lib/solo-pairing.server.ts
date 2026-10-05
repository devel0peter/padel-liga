import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "~/db/client.server";
import { interestSignups } from "~/db/schema";
import { deliver, queuePairIntros } from "~/lib/email/outbox.server";

import { pairError } from "./solo-pairing";

// Pairs two solo signups of the city and emails both (pairIntro). Returns an
// error message (Hungarian) instead when they can't be paired.
export async function pairSolos(aId: number, bId: number, city: string, cityName: string): Promise<string | null> {
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
  const [first, second] = await db.batch([pair(a.id, b.id), pair(b.id, a.id)]);
  if (first.length === 0 || second.length === 0) {
    // Lost the race for one of them: undo our half.
    for (const [done, id, partner] of [[first, a.id, b.id], [second, b.id, a.id]] as const)
      if (done.length) await unpairRow(id, partner);
    return "Valamelyikük közben párt kapott.";
  }

  // The pair is saved; an email problem must not undo it. Anything not sent
  // now stays queued for the hourly cron.
  try {
    await deliver(
      await queuePairIntros(
        { name: a.name1, email: a.email1, level: a.level },
        { name: b.name1, email: b.email1, level: b.level },
        cityName,
      ),
    );
  } catch (e) {
    console.error("pair intro email failed", e);
  }
  return null;
}

async function unpairRow(id: number, partner: number): Promise<void> {
  await db
    .update(interestSignups)
    .set({ pairedWith: null, status: "new", updatedAt: new Date() })
    .where(and(eq(interestSignups.id, id), eq(interestSignups.pairedWith, partner)));
}

// Undoes a pairing (no email). Both go back to the waiting list.
export async function unpairSolo(id: number, city: string): Promise<void> {
  const [row] = await db.select().from(interestSignups).where(eq(interestSignups.id, id));
  if (!row || row.city !== city || row.pairedWith == null) return;
  await unpairRow(row.id, row.pairedWith);
  await unpairRow(row.pairedWith, row.id);
}

import { and, count, desc, eq, or, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { accountInvites, interestSignups } from "~/db/schema";
import { INTEREST_INVITE_NOTE } from "~/lib/email/audience";
import { deleteMessagesTo } from "~/lib/email/outbox.server";

import type { SignupRow, Status } from "./signups-admin";

// Phase 0 volumes are small (hundreds at most), so the admin loads the whole
// list and filters in memory (filterSignups).
export async function listSignups(): Promise<SignupRow[]> {
  return db.select().from(interestSignups).orderBy(desc(interestSignups.createdAt), desc(interestSignups.id));
}

// Marking a signup withdrawn (#114) also undoes its solo pairing: the partner
// goes back to the waiting list ("Párkeresők"), and the withdrawn row points
// at nobody. Setting the status back later re-pairs nobody.
export async function updateSignup(
  id: number,
  changes: { status?: Status; adminNote?: string | null },
): Promise<void> {
  const now = new Date();
  const update = db
    .update(interestSignups)
    .set(changes.status === "withdrawn" ? { ...changes, pairedWith: null, updatedAt: now } : { ...changes, updatedAt: now })
    .where(eq(interestSignups.id, id));
  if (changes.status !== "withdrawn") {
    await update;
    return;
  }
  // One batch (a transaction): the partner is freed together with the status
  // change. A partner who is withdrawn too stays withdrawn.
  await db.batch([
    db
      .update(interestSignups)
      .set({
        pairedWith: null,
        status: sql`case when ${interestSignups.status} = 'paired' then 'new' else ${interestSignups.status} end`,
        updatedAt: now,
      })
      .where(eq(interestSignups.pairedWith, id)),
    update,
  ]);
}

// Permanent: used for deletion requests (privacy page, "Mik a jogaid?").
// Also removes the stored emails sent to them and the account invite their
// registration invite added (unless the address has another signup); an
// unsubscribe is kept. A solo paired with them
// goes back to the waiting list.
export async function deleteSignup(id: number): Promise<void> {
  const [row] = await db
    .delete(interestSignups)
    .where(eq(interestSignups.id, id))
    .returning({ email1: interestSignups.email1, email2: interestSignups.email2 });
  await db
    .update(interestSignups)
    .set({ pairedWith: null, status: "new", updatedAt: new Date() })
    .where(eq(interestSignups.pairedWith, id));
  if (!row) return;
  await deleteMessagesTo([row.email1, row.email2].filter((e): e is string => !!e));
  // The invite stays while another signup names the same address (as the
  // signer or, since D26, as the partner).
  for (const email of new Set([row.email1, row.email2].filter((e): e is string => !!e).map((e) => e.toLowerCase()))) {
    const [others] = await db
      .select({ n: count() })
      .from(interestSignups)
      .where(or(eq(sql`lower(${interestSignups.email1})`, email), eq(sql`lower(${interestSignups.email2})`, email)));
    if (others.n === 0)
      await db
        .delete(accountInvites)
        .where(and(eq(accountInvites.email, email), eq(accountInvites.note, INTEREST_INVITE_NOTE)));
  }
}

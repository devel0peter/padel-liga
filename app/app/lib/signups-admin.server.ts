import { and, count, desc, eq, sql } from "drizzle-orm";

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

export async function updateSignup(
  id: number,
  changes: { status?: Status; adminNote?: string | null },
): Promise<void> {
  await db
    .update(interestSignups)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(interestSignups.id, id));
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
  // The invite stays while another signup of the same address remains.
  const email = row.email1.toLowerCase();
  const [others] = await db
    .select({ n: count() })
    .from(interestSignups)
    .where(eq(sql`lower(${interestSignups.email1})`, email));
  if (others.n === 0)
    await db
      .delete(accountInvites)
      .where(and(eq(accountInvites.email, email), eq(accountInvites.note, INTEREST_INVITE_NOTE)));
}

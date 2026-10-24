import { and, desc, eq, ne, or } from "drizzle-orm";

import { db } from "~/db/client.server";
import { interestSignups } from "~/db/schema";

import { isLevel, type InterestSignup, type Level } from "./interest";

export async function saveInterest(signup: InterestSignup): Promise<void> {
  await db.insert(interestSignups).values({ ...signup, consentAt: new Date() });
}

// The level of the newest interest signup naming this (lowercase) email, to
// prefill the first-login page (the form stores emails lowercase): as the
// signer, a paired solo included, or as the partner of a pair signup (#89),
// who gets the level the signer gave for the pair.
export async function interestLevelFor(email: string): Promise<Level | null> {
  const [row] = await db
    .select({ level: interestSignups.level })
    .from(interestSignups)
    .where(
      or(
        eq(interestSignups.email1, email),
        // Someone else's signup counts only while it stands.
        and(eq(interestSignups.email2, email), ne(interestSignups.status, "withdrawn")),
      ),
    )
    .orderBy(desc(interestSignups.createdAt), desc(interestSignups.id))
    .limit(1);
  return row && isLevel(row.level) ? row.level : null;
}

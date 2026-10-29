import { and, desc, eq, ne, or } from "drizzle-orm";

import { db } from "~/db/client.server";
import { interestSignups } from "~/db/schema";

import { isLevel, type InterestSignup, type Level } from "./interest";

export async function saveInterest(signup: InterestSignup): Promise<void> {
  await db.insert(interestSignups).values({ ...signup, consentAt: new Date() });
}

// What the newest interest signup naming this (lowercase) email says, to
// prefill the first-login page (#130; the form stores emails lowercase): as
// the signer, a paired solo included, their own name; as the partner of a
// pair signup (#89), the name the signer gave them. Either way the level
// given for the signup. Null without a signup.
export async function interestProfileFor(email: string): Promise<{ name: string; level: Level | null } | null> {
  const [row] = await db
    .select({ email1: interestSignups.email1, name1: interestSignups.name1, name2: interestSignups.name2, level: interestSignups.level })
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
  if (!row) return null;
  return {
    name: ((row.email1 === email ? row.name1 : row.name2) ?? "").trim(),
    level: isLevel(row.level) ? row.level : null,
  };
}

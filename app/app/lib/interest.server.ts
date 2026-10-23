import { desc, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { interestSignups } from "~/db/schema";

import { isLevel, type InterestSignup, type Level } from "./interest";

export async function saveInterest(signup: InterestSignup): Promise<void> {
  await db.insert(interestSignups).values({ ...signup, consentAt: new Date() });
}

// The level someone gave on the interest form with this (lowercase) email, to
// prefill the first-login page; the newest signup wins. Only the signer's own
// email counts: the partner's email on a pair signup says nothing about the
// partner's level.
export async function interestLevelFor(email: string): Promise<Level | null> {
  const [row] = await db
    .select({ level: interestSignups.level })
    .from(interestSignups)
    .where(sql`lower(${interestSignups.email1}) = ${email}`)
    .orderBy(desc(interestSignups.createdAt), desc(interestSignups.id))
    .limit(1);
  return row && isLevel(row.level) ? row.level : null;
}

import { db } from "~/db/client.server";
import { interestSignups } from "~/db/schema";

import type { InterestSignup } from "./interest";

// The landing form's signup (#332 changes it). Nothing reads the list back
// since #333 (D128): no first-login prefill, no pair, no invite.
export async function saveInterest(signup: InterestSignup): Promise<void> {
  await db.insert(interestSignups).values({ ...signup, consentAt: new Date() });
}

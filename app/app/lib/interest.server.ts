import { db } from "~/db/client.server";
import { interestSignups } from "~/db/schema";

import type { InterestSignup } from "./interest";

export async function saveInterest(signup: InterestSignup): Promise<void> {
  await db.insert(interestSignups).values({ ...signup, consentAt: new Date() });
}

// Who a broadcast goes to. Pure (no I/O).
//
// Phase 0 audience: the signup list, filtered the same way as the admin list.
// Only the person who signed up is mailed, never the partner they entered
// (spec section 17: nothing else goes to the partner until they register).
// Later audiences (e.g. active league players) get their own function here.

import { CITIES, OTHER_CITY } from "../cities";
import { levelLabel, STATUSES, type Filters, type SignupRow } from "../signups-admin";

export type Recipient = { email: string; name: string };

export function signupRecipients(
  rows: Pick<SignupRow, "email1" | "name1">[],
  suppressed: ReadonlySet<string>,
): { recipients: Recipient[]; suppressed: number } {
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  let skipped = 0;
  for (const r of rows) {
    const email = r.email1.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    if (suppressed.has(email)) skipped++;
    else recipients.push({ email, name: r.name1 });
  }
  return { recipients, suppressed: skipped };
}

export function audienceLabel(f: Filters): string {
  const parts = [
    f.city === OTHER_CITY ? "Más város" : CITIES.find((c) => c.slug === f.city)?.name,
    f.status ? (STATUSES as Record<string, string>)[f.status] : undefined,
    f.level ? levelLabel(f.level) : undefined,
    f.mode === "pair" ? "Pár" : f.mode === "solo" ? "Egyéni" : undefined,
    f.q ? `„${f.q}”` : undefined,
  ].filter(Boolean);
  return parts.length ? `Jelentkezők: ${parts.join(" · ")}` : "Minden jelentkező";
}

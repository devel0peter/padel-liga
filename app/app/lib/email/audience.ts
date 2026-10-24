// Who a broadcast goes to. Pure (no I/O).
//
// Phase 0 audience: the signup list, filtered the same way as the admin list.
// Only the person who signed up is mailed, never the partner they entered
// (spec section 17: nothing else goes to the partner until they register).
// Later audiences (e.g. active league players) get their own function here.

import { cityName, OTHER_CITY, type City } from "../cities";
import { soloIsPaired, type SignupLink } from "../signup-partners";
import { levelLabel, NO_REF, STATUSES, type Filters, type SignupRow } from "../signups-admin";

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

// The registration invite (#20, spec section 3, D26) goes to players who
// start with a partner from the signup, in a city that has a league, once per
// address: both addresses of a pair signup, and both solos once a Szervező
// paired them. A solo still waiting for a partner gets nothing. Skipped:
// withdrawn signups, unsubscribed or bounced addresses, addresses that
// already have an account, and addresses already invited through any of
// their signups (invited_at for email1, invited2_at for email2).
// account_invites.note of the addresses invited this way, so a deletion
// request can remove exactly these rows (signups-admin.server.ts).
export const INTEREST_INVITE_NOTE = "Jelentkező";

export type InviteCandidate = SignupLink & { invitedAt: Date | null; invited2At: Date | null };

export function inviteRecipients(
  rows: readonly InviteCandidate[],
  ctx: { leagueCities: ReadonlySet<string>; suppressed: ReadonlySet<string>; accounts: ReadonlySet<string> },
): Recipient[] {
  const invited = new Set<string>();
  for (const r of rows) {
    if (r.invitedAt) invited.add(r.email1.toLowerCase());
    if (r.invited2At && r.email2) invited.add(r.email2.toLowerCase());
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const r of rows) {
    if (r.status === "withdrawn" || !ctx.leagueCities.has(r.city)) continue;
    const people =
      r.mode === "pair"
        ? [{ email: r.email1, name: r.name1 }, ...(r.email2 ? [{ email: r.email2, name: r.name2 ?? "" }] : [])]
        : soloIsPaired(r, byId)
          ? [{ email: r.email1, name: r.name1 }]
          : [];
    for (const p of people) {
      const email = p.email.toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      if (invited.has(email) || ctx.suppressed.has(email) || ctx.accounts.has(email)) continue;
      recipients.push({ email, name: p.name });
    }
  }
  return recipients;
}

export function audienceLabel(f: Filters, cities: readonly Pick<City, "slug" | "name">[] = []): string {
  const parts = [
    f.city === OTHER_CITY ? "Más város" : f.city ? cityName(f.city, cities) : undefined,
    f.status ? (STATUSES as Record<string, string>)[f.status] : undefined,
    f.level ? levelLabel(f.level) : undefined,
    f.mode === "pair" ? "Pár" : f.mode === "solo" ? "Egyéni" : undefined,
    f.ref === NO_REF ? "Forrás nélkül" : f.ref ? `Forrás: ${f.ref}` : undefined,
    f.club === NO_REF ? "Klub nélkül" : f.club ? `Klub: ${f.club}` : undefined,
    f.q ? `„${f.q}”` : undefined,
  ].filter(Boolean);
  return parts.length ? `Jelentkezők: ${parts.join(" · ")}` : "Minden jelentkező";
}

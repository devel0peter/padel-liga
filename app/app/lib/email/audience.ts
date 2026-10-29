// Who a broadcast goes to. Pure (no I/O).
//
// Phase 0 audience: the signup list, filtered the same way as the admin list.
// Only the person who signed up is mailed, never the partner they entered
// (spec section 17: nothing else goes to the partner until they register).
// Later audiences (e.g. active league players) get their own function here.

import { cityName, OTHER_CITY, type City } from "../cities";
import { seasonEnd, type Season } from "../seasons";
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

// The registration invite (#20, spec section 3, D26, D34) goes to everyone
// on the signup list in a city that has a league, once per address: both
// addresses of a pair signup, and every solo. A solo still waiting for a
// partner gets its own text ("solo"); the signer of a pair signup without the
// partner's email gets one extra sentence ("no_partner_email"). Skipped:
// withdrawn signups, unsubscribed or bounced addresses, addresses that
// already have an account, and addresses already invited through any of
// their signups (invited_at for email1, invited2_at for email2).
// account_invites.note of the addresses invited this way, so a deletion
// request can remove exactly these rows (signups-admin.server.ts).
export const INTEREST_INVITE_NOTE = "Jelentkező";

export type InviteCandidate = SignupLink & { invitedAt: Date | null; invited2At: Date | null };

export type InviteVariant = "solo" | "no_partner_email";

// `city`: the signup's city slug, for the invite's start sentence (#131).
export type InviteRecipient = Recipient & { city: string; variant?: InviteVariant };

export function inviteRecipients(
  rows: readonly InviteCandidate[],
  ctx: { leagueCities: ReadonlySet<string>; suppressed: ReadonlySet<string>; accounts: ReadonlySet<string> },
): InviteRecipient[] {
  const invited = new Set<string>();
  for (const r of rows) {
    if (r.invitedAt) invited.add(r.email1.toLowerCase());
    if (r.invited2At && r.email2) invited.add(r.email2.toLowerCase());
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const recipients: InviteRecipient[] = [];
  for (const r of rows) {
    if (r.status === "withdrawn" || !ctx.leagueCities.has(r.city)) continue;
    const people: { email: string; name: string; variant?: InviteVariant }[] =
      r.mode === "pair"
        ? r.email2
          ? [
              { email: r.email1, name: r.name1 },
              { email: r.email2, name: r.name2 ?? "" },
            ]
          : [{ email: r.email1, name: r.name1, variant: "no_partner_email" }]
        : [{ email: r.email1, name: r.name1, ...(soloIsPaired(r, byId) ? {} : { variant: "solo" as const }) }];
    for (const p of people) {
      const email = p.email.toLowerCase();
      if (seen.has(email)) continue;
      seen.add(email);
      if (invited.has(email) || ctx.suppressed.has(email) || ctx.accounts.has(email)) continue;
      recipients.push({ email, name: p.name, city: r.city, ...(p.variant ? { variant: p.variant } : {}) });
    }
  }
  return recipients;
}

// Where and when the league starts, for the invite's opening line (#131):
// "A liga november 9-én indul (Győr), a nevezés november 6-ig tart." Per
// city slug: the city's name and round 1's start of its league's current
// season (the earliest one that hasn't ended, as on the landing page; a city
// with several leagues takes the first one that has such a season), and the
// season's last registration day while registration hasn't closed. Only while
// round 1 is still ahead: a city without a season, or whose current season
// has started, has no entry, and the invite leaves the sentence out.
export type InviteStart = { city: string; firstRound: Date; registrationCloses: Date | null };

export function inviteStarts(
  leagues: readonly { id: number; city: string }[],
  seasons: readonly Pick<Season, "leagueId" | "phases" | "registrationClosesAt">[],
  cities: readonly Pick<City, "slug" | "name">[],
  now: Date,
): Map<string, InviteStart> {
  const firstRound = (s: Pick<Season, "phases">) => s.phases.find((p) => p.number === 1)?.startsAt ?? null;
  const current = (leagueId: number) =>
    seasons
      .filter((s) => s.leagueId === leagueId && firstRound(s) !== null && (seasonEnd(s) ?? now) >= now)
      .sort((a, b) => firstRound(a)!.getTime() - firstRound(b)!.getTime())[0];
  const out = new Map<string, InviteStart>();
  const decided = new Set<string>();
  for (const league of [...leagues].sort((a, b) => a.id - b.id)) {
    if (decided.has(league.city)) continue;
    const season = current(league.id);
    if (!season) continue;
    decided.add(league.city);
    const start = firstRound(season)!;
    if (start > now)
      out.set(league.city, {
        city: cityName(league.city, cities),
        firstRound: start,
        registrationCloses: season.registrationClosesAt > now ? season.registrationClosesAt : null,
      });
  }
  return out;
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

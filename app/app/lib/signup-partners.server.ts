import { and, asc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { interestSignups, leagues, pairs, users } from "~/db/schema";
import { listedCities } from "~/lib/cities.server";

import { activePairWith } from "./pairs.server";
import { signupPartners, type SignupLink, type SignupPartner } from "./signup-partners";

// The pair from the interest signup (#89, D27), in D1. The rules are in
// signup-partners.ts.

const lower = (column: typeof interestSignups.email1 | typeof interestSignups.email2) => sql`lower(${column})`;

// Every signup naming this email, plus the rows of the solos it was paired
// with (their partner's name and email are on those rows).
async function signupRowsFor(email: string): Promise<SignupLink[]> {
  const me = email.toLowerCase();
  const pairedWith = db
    .select({ id: interestSignups.pairedWith })
    .from(interestSignups)
    .where(and(eq(lower(interestSignups.email1), me), isNotNull(interestSignups.pairedWith)));
  return db
    .select({
      id: interestSignups.id,
      mode: interestSignups.mode,
      city: interestSignups.city,
      status: interestSignups.status,
      name1: interestSignups.name1,
      email1: interestSignups.email1,
      name2: interestSignups.name2,
      email2: interestSignups.email2,
      pairedWith: interestSignups.pairedWith,
      createdAt: interestSignups.createdAt,
    })
    .from(interestSignups)
    .where(
      or(eq(lower(interestSignups.email1), me), eq(lower(interestSignups.email2), me), inArray(interestSignups.id, pairedWith)),
    );
}

const partnersOf = async (email: string) => signupPartners(await signupRowsFor(email), email);

type Partner = SignupPartner & { leagueId: number; userId: string | null };

// The signup partner per league for this email, when the partner's own
// signups name this email back for that city (both said so: nobody is put in
// a pair by someone else's signup alone), with their account if they have
// finished registering (first-login page done). A city's pair goes to its
// first league; a city that isn't listed or has no league has none.
async function partnersFor(email: string): Promise<Partner[]> {
  const me = email.toLowerCase();
  const named = await partnersOf(me);
  const found: SignupPartner[] = [];
  for (const p of named)
    if ((await partnersOf(p.email)).some((back) => back.city === p.city && back.email === me)) found.push(p);
  if (found.length === 0) return [];
  const listed = new Set((await listedCities()).map((c) => c.slug));
  const cities = [...new Set(found.map((p) => p.city))].filter((c) => listed.has(c));
  if (cities.length === 0) return [];
  const [leagueRows, accounts] = await db.batch([
    db.select({ id: leagues.id, city: leagues.city }).from(leagues).where(inArray(leagues.city, cities)).orderBy(asc(leagues.id)),
    db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(inArray(users.email, found.map((p) => p.email)), isNotNull(users.consentAt))),
  ]);
  const leagueOf = new Map<string, number>();
  for (const l of leagueRows) if (!leagueOf.has(l.city)) leagueOf.set(l.city, l.id);
  const userOf = new Map(accounts.map((u) => [u.email.toLowerCase(), u.id]));
  return found.flatMap((p) => {
    const leagueId = leagueOf.get(p.city);
    return leagueId ? [{ ...p, leagueId, userId: userOf.get(p.email) ?? null }] : [];
  });
}

// Any pair, active or dissolved, of these two players in the league.
function pairOf(leagueId: number, a: string, b: string) {
  return sql`exists (select 1 from ${pairs} where ${pairs.leagueId} = ${leagueId}
    and ((${pairs.playerA} = ${a} and ${pairs.playerB} = ${b}) or (${pairs.playerA} = ${b} and ${pairs.playerB} = ${a})))`;
}

// When a player logs in or finishes the first-login page: forms the active
// pair with the partner their signup names, if that partner has registered
// too, so whichever of the two arrives second makes it (D27). Only once: if
// the two have ever been a pair in that league (a dissolved pair included),
// nothing happens, so a dissolve sticks. Skipped silently if either is
// already in an active pair in that league (a Szervező may have paired them
// differently, #97). Never throws: a problem here must not stop a login.
export async function formSignupPairs(userId: string): Promise<void> {
  try {
    const [me] = await db
      .select({ id: users.id, email: users.email, consentAt: users.consentAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!me?.consentAt) return;
    for (const p of await partnersFor(me.email)) {
      if (!p.userId || p.userId === me.id) continue;
      const [ever] = await db
        .select({ id: pairs.id })
        .from(pairs)
        .where(
          and(
            eq(pairs.leagueId, p.leagueId),
            or(
              and(eq(pairs.playerA, p.userId), eq(pairs.playerB, me.id)),
              and(eq(pairs.playerA, me.id), eq(pairs.playerB, p.userId)),
            ),
          ),
        )
        .limit(1);
      if (ever) continue;
      const players = [p.userId, me.id];
      // The partner registered first, so is player A.
      await db.run(sql`insert into ${pairs} (league_id, player_a, player_b)
        select ${p.leagueId}, ${p.userId}, ${me.id}
        where not ${activePairWith(p.leagueId, players)} and not ${pairOf(p.leagueId, p.userId, me.id)}`);
    }
  } catch (e) {
    console.error("signup pair failed", e);
  }
}

// "/pair" without a pair (#89): per league, the name of the signup partner
// who hasn't registered yet. Never their email.
export async function waitingPartners(email: string): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const p of await partnersFor(email)) if (!p.userId && p.name) out.set(p.leagueId, p.name);
  return out;
}

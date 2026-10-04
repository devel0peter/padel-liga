import { and, gte, lt, lte, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { interestSignups, landingViews } from "~/db/schema";

import { budapestDay, type LandingCount, type Period, type SignupStamp } from "./traffic";

export async function recordLanding(ref: string | null, now = new Date()): Promise<void> {
  await db
    .insert(landingViews)
    .values({ day: budapestDay(now), ref: ref ?? "", count: 1 })
    .onConflictDoUpdate({
      target: [landingViews.day, landingViews.ref],
      set: { count: sql`${landingViews.count} + 1` },
    });
}

export async function listLandings({ from, to }: Period): Promise<LandingCount[]> {
  const rows = await db
    .select()
    .from(landingViews)
    .where(and(gte(landingViews.day, from), lte(landingViews.day, to)));
  return rows.map((r) => ({ day: r.day, ref: r.ref || null, count: r.count }));
}

// A day of slack on each side covers the Budapest/UTC offset; buildFunnel
// then keeps only the period's Budapest days.
export async function listSignupStamps({ from, to }: Period): Promise<SignupStamp[]> {
  const start = new Date(`${from}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 2);
  return db
    .select({ createdAt: interestSignups.createdAt, ref: interestSignups.ref })
    .from(interestSignups)
    .where(and(gte(interestSignups.createdAt, start), lt(interestSignups.createdAt, end)));
}

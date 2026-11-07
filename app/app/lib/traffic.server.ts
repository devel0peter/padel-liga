import { and, eq, gte, lte, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { landingViews } from "~/db/schema";

import { budapestDay, type LandingCount, type Period } from "./traffic";

// The beacon is public, so anyone can send made-up sources. Past this many
// sources in a day, a new one counts as no source instead of adding a row.
const MAX_REFS_PER_DAY = 50;

export async function recordLanding(ref: string | null, now = new Date()): Promise<void> {
  const day = budapestDay(now);
  if (ref) {
    const refs = await db.select({ ref: landingViews.ref }).from(landingViews).where(eq(landingViews.day, day));
    if (refs.length >= MAX_REFS_PER_DAY && !refs.some((r) => r.ref === ref)) ref = null;
  }
  await db
    .insert(landingViews)
    .values({ day, ref: ref ?? "", count: 1 })
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


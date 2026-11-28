import { addDays, budapestDay, budapestTime } from "@padel-liga/rules";
import { and, eq, gte, inArray, isNotNull, isNull, lt } from "drizzle-orm";

import { db } from "~/db/client.server";
import { broadcasts, emailSuppressions, users } from "~/db/schema";
import { createBroadcast } from "~/lib/email/outbox.server";
import { memberOf } from "~/lib/league-members.server";

// Organizer broadcasts (#387): at most 1 broadcast per league per Budapest
// calendar day, only to players of that league, never showing email addresses
// to a Szervező.

export type BroadcastCap = { allowed: true } | { allowed: false; message: string };

export async function leagueBroadcastCap(leagueId: number, now = new Date()): Promise<BroadcastCap> {
  const today = budapestDay(now);
  const start = budapestTime(today, 0, 0);
  const tomorrow = addDays(today, 1);
  const end = budapestTime(tomorrow, 0, 0);
  const [existing] = await db
    .select({ id: broadcasts.id })
    .from(broadcasts)
    .where(and(eq(broadcasts.leagueId, leagueId), gte(broadcasts.createdAt, start), lt(broadcasts.createdAt, end)))
    .limit(1);
  if (existing) {
    return {
      allowed: false,
      message: "Ma már küldtél körlevelet ennek a ligának. Naponta legfeljebb egy körlevél küldhető, a következő holnap 00:00-tól lehetséges.",
    };
  }
  return { allowed: true };
}

export async function leagueBroadcastAudience(
  leagueId: number,
  userIds?: readonly string[],
): Promise<{ id: string; name: string; email: string }[]> {
  const [rows, suppressed] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(
        and(
          isNotNull(users.consentAt),
          isNull(users.deletedAt),
          memberOf(leagueId, users.id),
          userIds && userIds.length > 0 ? inArray(users.id, [...userIds]) : undefined,
        ),
      ),
    db.select({ email: emailSuppressions.email }).from(emailSuppressions),
  ]);
  const blocked = new Set(suppressed.map((s) => s.email.toLowerCase()));
  return rows.filter((r) => !blocked.has(r.email.toLowerCase()));
}

export async function sendLeagueBroadcast(input: {
  leagueId: number;
  subject: string;
  body: string;
  audienceLabel: string;
  userIds?: readonly string[];
  actor: { id: string; email: string };
  now?: Date;
}): Promise<{ ok: true; broadcastId: number; count: number } | { ok: false; error: string }> {
  const now = input.now ?? new Date();
  const cap = await leagueBroadcastCap(input.leagueId, now);
  if (!cap.allowed) return { ok: false, error: cap.message };

  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) return { ok: false, error: "Adj meg tárgyat." };
  if (!body) return { ok: false, error: "Írj üzenetet." };

  const recipients = await leagueBroadcastAudience(input.leagueId, input.userIds);
  if (recipients.length === 0) return { ok: false, error: "Nincs elérhető címzett ebben a ligában." };

  const broadcastId = await createBroadcast({
    leagueId: input.leagueId,
    subject,
    body,
    audience: input.audienceLabel,
    recipients: recipients.map((r) => ({ email: r.email, name: r.name || "Játékos" })),
    createdBy: input.actor.email,
    actorId: input.actor.id,
    createdAt: now,
  });
  return { ok: true, broadcastId, count: recipients.length };
}

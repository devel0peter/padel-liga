import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "~/db/client.server";
import { emailMessages, emailSuppressions } from "~/db/schema";

import { COMMS_LOG_LIMIT, commsStatus, nextDelivery, sentVia, shownSubject, type CommsTone, type Delivery, type Via } from "./delivery";
import { isOpenToken, openStatus } from "./opens";
import { kindLabel } from "./outbox-view";

// A person's email log (#242, D157), a section of the Admin's player profile
// (#301): every email stored for their address, newest first, and Resend's
// delivery events tied to the email they name. Admin only (the profile
// checks it). Nothing here shows another person's address: subjects and
// failure reasons have every address hidden.

export type CommsRow = {
  id: number;
  kind: string;
  kindLabel: string;
  subject: string;
  createdAt: Date;
  sentAt: Date | null;
  via: Via | null;
  status: string;
  tone: CommsTone;
  note: string | null;
  // When Resend reported the delivery state, if it did.
  deliveryAt: Date | null;
  // Whether it was opened (#243): the first open and the count, that nobody
  // knows, or null for an email that isn't tracked or hasn't gone out.
  opened: string | null;
};

export type CommsLog = {
  rows: CommsRow[];
  total: number;
  suppression: { reason: "unsubscribed" | "bounced" | "complained"; since: Date } | null;
};

const lower = (email: string) => email.trim().toLowerCase();

export async function personCommsLog(email: string): Promise<CommsLog> {
  const address = lower(email);
  // Addresses are stored as given: the account deletion matches them the same way.
  const mine = eq(sql`lower(${emailMessages.toEmail})`, address);
  const [rows, [{ n }], [suppressed]] = await Promise.all([
    db
      .select({
        id: emailMessages.id,
        kind: emailMessages.kind,
        subject: emailMessages.subject,
        status: emailMessages.status,
        lastError: emailMessages.lastError,
        providerId: emailMessages.providerId,
        delivery: emailMessages.delivery,
        deliveryAt: emailMessages.deliveryAt,
        // Whether it carries a tracking image; the token itself never leaves the server.
        tracked: sql<number>`${emailMessages.openToken} is not null`,
        openedAt: emailMessages.openedAt,
        openCount: emailMessages.openCount,
        sentAt: emailMessages.sentAt,
        createdAt: emailMessages.createdAt,
      })
      .from(emailMessages)
      .where(mine)
      .orderBy(desc(emailMessages.createdAt), desc(emailMessages.id))
      .limit(COMMS_LOG_LIMIT),
    db.select({ n: sql<number>`count(*)` }).from(emailMessages).where(mine),
    db
      .select({ reason: emailSuppressions.reason, since: emailSuppressions.createdAt })
      .from(emailSuppressions)
      .where(eq(sql`lower(${emailSuppressions.email})`, address)),
  ]);
  return {
    rows: rows.map((r) => {
      const s = commsStatus(r);
      return {
        id: r.id,
        kind: r.kind,
        kindLabel: kindLabel(r.kind),
        subject: shownSubject(r.kind, r.subject),
        createdAt: r.createdAt,
        sentAt: r.sentAt,
        via: r.status === "sent" ? sentVia(r.providerId) : null,
        status: s.label,
        tone: s.tone,
        note: s.note,
        deliveryAt: r.delivery ? r.deliveryAt : null,
        opened: openStatus({ tracked: !!r.tracked, status: r.status, openedAt: r.openedAt, openCount: r.openCount }),
      };
    }),
    total: n,
    suppression: suppressed ?? null,
  };
}

// A Resend delivery event (#242): the email it names (by the id Resend gave
// it) gets the delivery state and its time, unless it already has a
// stronger one (delivery.ts nextDelivery). False when no stored email has
// that id (an email deleted with its account, or one from before the ids
// were stored) or nothing changed.
export async function recordDelivery(event: { providerId: string; delivery: Delivery; at: Date }): Promise<boolean> {
  const [row] = await db
    .select({ id: emailMessages.id, delivery: emailMessages.delivery })
    .from(emailMessages)
    .where(eq(emailMessages.providerId, event.providerId))
    .limit(1);
  if (!row) return false;
  const next = nextDelivery(row.delivery, event);
  if (!next) return false;
  // Only if no other event changed it meanwhile (Resend may send two at once).
  const same = row.delivery === null ? isNull(emailMessages.delivery) : eq(emailMessages.delivery, row.delivery);
  const changed = await db
    .update(emailMessages)
    .set({ delivery: next.delivery, deliveryAt: next.at })
    .where(and(eq(emailMessages.id, row.id), same))
    .returning({ id: emailMessages.id });
  return changed.length > 0;
}

// The tracking image of one email was loaded (#243, D161): that email gets
// its first open time (kept) and one more open. Only the time is recorded:
// no address, device or IP. A token of the wrong shape or one no stored
// email has (deleted with its account, or made up) changes nothing; the
// caller answers the same either way. True when an email was marked.
export async function recordOpen(token: string, at = new Date()): Promise<boolean> {
  if (!isOpenToken(token)) return false;
  const rows = await db
    .update(emailMessages)
    .set({ openedAt: sql`coalesce(${emailMessages.openedAt}, ${Math.floor(at.getTime() / 1000)})`, openCount: sql`${emailMessages.openCount} + 1` })
    .where(eq(emailMessages.openToken, token))
    .returning({ id: emailMessages.id });
  return rows.length > 0;
}

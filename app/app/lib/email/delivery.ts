// A person's email log on the Admin's player profile (#242, D157): how each
// email went out and what happened to it. Pure (no I/O); the D1 side is
// comms-log.server.ts, the Resend events come in through
// routes/webhooks.resend.ts.

import { formatDateTime } from "~/lib/format";

import { hideAddresses } from "./outbox-view";

// The log shows the newest this many; the profile says when there are more.
export const COMMS_LOG_LIMIT = 100;

export type Delivery = "delivered" | "bounced" | "soft_bounced" | "complained";

type ResendEvent = {
  type?: unknown;
  created_at?: unknown;
  data?: { email_id?: unknown; bounce?: { type?: unknown } };
};

// What a Resend event says about the email it names (`data.email_id`, the id
// Resend gave it when we sent it, stored as provider_id), or null for an
// event that says nothing about delivery. A bounce Resend calls "Permanent"
// is for good; any other is temporary (mailbox full, server down). The time
// is the event's own, else `now`.
export function deliveryFromEvent(event: ResendEvent, now = new Date()): { providerId: string; delivery: Delivery; at: Date } | null {
  const providerId = typeof event.data?.email_id === "string" ? event.data.email_id : "";
  if (!providerId) return null;
  let delivery: Delivery;
  if (event.type === "email.delivered") delivery = "delivered";
  else if (event.type === "email.bounced") delivery = event.data?.bounce?.type === "Permanent" ? "bounced" : "soft_bounced";
  else if (event.type === "email.complained") delivery = "complained";
  else return null;
  const at = typeof event.created_at === "string" ? new Date(event.created_at) : null;
  return { providerId, delivery, at: at && !Number.isNaN(at.getTime()) ? at : now };
}

// How much an event says: a later "delivered" after a temporary bounce means
// the retry arrived; a spam complaint comes after the delivery; nothing
// arrives after a permanent bounce. Events can come out of order or twice,
// so the stronger one stays, with its own time; a weaker or repeated one
// changes nothing (null).
const RANK: Record<Delivery, number> = { soft_bounced: 1, delivered: 2, bounced: 3, complained: 4 };

export function nextDelivery(current: Delivery | null, incoming: { delivery: Delivery; at: Date }): { delivery: Delivery; at: Date } | null {
  return !current || RANK[incoming.delivery] > RANK[current] ? incoming : null;
}

// How an email went out, from the id the provider gave it: the relay's is
// our Message-ID ("<…@…>"), Resend's a bare id, local dev's "dev-…" (the
// console). Null: not sent.
export type Via = "relay" | "resend" | "console";

export function sentVia(providerId: string | null): Via | null {
  if (!providerId) return null;
  if (providerId.startsWith("dev-")) return "console";
  return providerId.includes("@") ? "relay" : "resend";
}

export const VIA_LABELS: Record<Via, string> = { relay: "Google-relé", resend: "Resend", console: "Konzol (fejlesztés)" };

export type CommsTone = "ok" | "todo" | "bad" | "muted";

// One email's status as the log shows it: the label, its tone, and a note
// (the failure reason with every address hidden, or that the relay doesn't
// report delivery).
export function commsStatus(row: {
  status: "pending" | "sending" | "sent" | "failed";
  providerId: string | null;
  delivery: Delivery | null;
  lastError: string | null;
}): { label: string; tone: CommsTone; note: string | null } {
  if (row.status === "pending") return { label: "Sorban vár", tone: "todo", note: null };
  if (row.status === "sending") return { label: "Küldés alatt", tone: "todo", note: null };
  if (row.status === "failed") return { label: "Nem ment ki", tone: "bad", note: row.lastError ? hideAddresses(row.lastError) : null };
  switch (row.delivery) {
    case "delivered":
      return { label: "Kézbesítve", tone: "ok", note: null };
    case "bounced":
      return { label: "Visszapattant", tone: "bad", note: "Végleges: a cím nem fogad levelet." };
    case "soft_bounced":
      return { label: "Átmenetileg visszapattant", tone: "todo", note: "Pl. tele a postafiók; a következő levél még megérkezhet." };
    case "complained":
      return { label: "Spamnek jelölte", tone: "bad", note: null };
    case null:
      return {
        label: "Elküldve",
        tone: "ok",
        note: sentVia(row.providerId) === "relay" ? "A Google-relé nem jelzi vissza a kézbesítést." : null,
      };
  }
}

export const SUPPRESSION_LABELS = {
  unsubscribed: "leiratkozott",
  bounced: "a cím visszapattant",
  complained: "spamnek jelölt egy levelet",
} as const;

// The log's header line when the address is on the do-not-mail list: no
// broadcast, pair, entry, group or match email goes to it any more.
export function suppressionNote(s: { reason: keyof typeof SUPPRESSION_LABELS; since: Date } | null): string | null {
  return s ? `Letiltott cím: ${SUPPRESSION_LABELS[s.reason]}, ${formatDateTime(s.since)} óta. Körlevelet és értesítő levelet nem küldünk rá.` : null;
}

// A subject shows no address (a pair intro may name the partner's), and a
// login code's subject ("216 950 a belépőkódod") not the code: the Admin
// must not be able to log in as the player with it.
export function shownSubject(kind: string, subject: string): string {
  const shown = hideAddresses(subject);
  return kind === "login_code" ? shown.replace(/\d/g, "•") : shown;
}

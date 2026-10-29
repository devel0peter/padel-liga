// How many emails we may send right now within the league's own daily limit.
// Pure (no I/O). The limit follows the transport (#111, #127): 5,000 with Google's
// SMTP relay (half of the 10,000 per user a day it allows, as Google can lower
// an account's limit); without the relay everything goes through Resend, whose
// free plan sends 100 a day, so EMAIL_DAILY_LIMIT (default 100) applies.

// Kept free for signup confirmations, so a large broadcast can't block them.
export const TRANSACTIONAL_RESERVE = 15;
// Kept free for login codes, so a flood of signups can't lock everyone out.
// Smaller than TRANSACTIONAL_RESERVE, so broadcasts never use it either.
export const LOGIN_RESERVE = 10;

export type MessageKind =
  | "signup_confirmation"
  | "partner_notice"
  | "broadcast"
  | "login_code"
  | "pair_intro"
  | "registration_invite"
  | "pair_invite"
  | "pair_answer"
  | "pair_dissolved"
  | "season_entry_decision"
  | "groups_published";

// Mail to a whole list: sent last, behind TRANSACTIONAL_RESERVE, so a big
// list spreads over days without delaying signup emails or login codes.
export const BULK_KINDS = ["broadcast", "registration_invite"] as const satisfies readonly MessageKind[];

function isBulk(kind: MessageKind): boolean {
  return (BULK_KINDS as readonly MessageKind[]).includes(kind);
}

export function sendBudget(dailyLimit: number, sentLast24h: number, kind: MessageKind): number {
  const reserve = isBulk(kind) ? TRANSACTIONAL_RESERVE : kind === "login_code" ? 0 : LOGIN_RESERVE;
  return Math.max(0, dailyLimit - sentLast24h - reserve);
}

export const RESEND_DAILY_LIMIT = 100;

// At most this many of the emails just queued are sent inside the request
// that queued them (outbox.server.ts deliverNow); the hourly cron sends the
// rest. Here (pure) so the admin pages can say it.
export const SEND_NOW_MAX = 50;
export const RELAY_DAILY_LIMIT = 5000;

export function parseDailyLimit(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : RESEND_DAILY_LIMIT;
}

// relay: the SMTP relay's login is set (smtp.server.ts relayConfigured).
export function effectiveDailyLimit(relay: boolean, value: string | undefined): number {
  return relay ? RELAY_DAILY_LIMIT : parseDailyLimit(value);
}

// How many emails we may send right now without hitting the provider's daily
// quota (Resend free: 100/day). Pure (no I/O).

// Kept free for signup confirmations, so a large broadcast can't block them.
export const TRANSACTIONAL_RESERVE = 15;

export type MessageKind = "signup_confirmation" | "partner_notice" | "broadcast";

export function sendBudget(dailyLimit: number, sentLast24h: number, kind: MessageKind): number {
  const reserve = kind === "broadcast" ? TRANSACTIONAL_RESERVE : 0;
  return Math.max(0, dailyLimit - sentLast24h - reserve);
}

export function parseDailyLimit(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 100;
}

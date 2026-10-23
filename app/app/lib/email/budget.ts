// How many emails we may send right now without hitting the provider's daily
// quota (Resend free: 100/day). Pure (no I/O).

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
  | "registration_invite";

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

export function parseDailyLimit(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 100;
}

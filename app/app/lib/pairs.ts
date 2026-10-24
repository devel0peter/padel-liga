// Pairs and partner invites (spec section 4, #21). Pure (no I/O) so every
// rule is unit tested; the D1 side is pairs.server.ts.
//
// One player invites the other by email; the pair exists once the invitee
// accepts. A player is in at most one active pair per league, and has at most
// one pending outgoing invite per league. Invites don't expire; the inviter
// can cancel. Accepting cancels both players' other pending invites in that
// league. A pair can be dissolved, except while it plays in a group of a
// running phase (partner change only between phases).

import { isValidEmail, normalizeEmail } from "./auth/rules";

// Account invites made for an invitee without an account (D14), so the link
// works before registration opens (account_invites.note).
export const PAIR_INVITE_NOTE = "Pármeghívó";

// Invites one player may send in 24 hours, in all leagues. Cancelling and
// re-inviting would otherwise let anyone mail any address from our domain
// without limit, and every invite uses up the daily email quota.
export const MAX_INVITES_PER_DAY = 5;

export type InviteStatus = "pending" | "accepted" | "declined" | "cancelled";

export type InviteRefusal = "email" | "self" | "inviter_paired" | "invitee_paired" | "already_inviting" | "too_many";

export const INVITE_REFUSALS: Record<InviteRefusal, string> = {
  email: "Adj meg egy érvényes e-mail-címet.",
  self: "Magadat nem hívhatod meg.",
  inviter_paired: "Ebben a ligában már van párod. Új párt csak a mostani megszüntetése után hívhatsz.",
  invitee_paired: "Neki már van párja ebben a ligában.",
  already_inviting: "Már elküldtél egy meghívót ebben a ligában. Vond vissza, ha mást hívnál.",
  too_many: `Egy nap legfeljebb ${MAX_INVITES_PER_DAY} meghívót küldhetsz. Próbáld holnap.`,
};

export type InviteCheck = {
  inviterEmail: string;
  // As typed in the form.
  inviteeEmail: string;
  inviterPaired: boolean;
  // False when the invitee has no account yet.
  inviteePaired: boolean;
  pendingOutgoing: boolean;
  // Invites the inviter created in the last 24 hours, any status, any league.
  sentLastDay: number;
};

// Whether a new invite may be sent; the normalized invitee email if so.
export function checkInvite(c: InviteCheck): { ok: true; email: string } | { ok: false; reason: InviteRefusal } {
  const email = normalizeEmail(c.inviteeEmail);
  if (!isValidEmail(email)) return { ok: false, reason: "email" };
  if (email === normalizeEmail(c.inviterEmail)) return { ok: false, reason: "self" };
  if (c.inviterPaired) return { ok: false, reason: "inviter_paired" };
  if (c.pendingOutgoing) return { ok: false, reason: "already_inviting" };
  if (c.inviteePaired) return { ok: false, reason: "invitee_paired" };
  if (c.sentLastDay >= MAX_INVITES_PER_DAY) return { ok: false, reason: "too_many" };
  return { ok: true, email };
}

export type AnswerRefusal = "not_yours" | "answered" | "inviter_paired" | "you_paired";

export const ANSWER_REFUSALS: Record<AnswerRefusal, string> = {
  not_yours: "Ez a meghívó nem ehhez a fiókhoz szól. Lépj be azzal a címmel, amelyre a levél jött.",
  answered: "Erre a meghívóra már nem lehet válaszolni.",
  inviter_paired: "Aki meghívott, közben már párt talált ebben a ligában.",
  you_paired: "Ebben a ligában már van párod.",
};

export type AnswerCheck = {
  status: InviteStatus;
  inviteeEmail: string;
  userEmail: string;
  // Only checked when accepting.
  inviterPaired: boolean;
  userPaired: boolean;
};

// Only the invitee answers, by the email the invite was sent to: a forwarded
// link is no use to anyone else. Declining needs no free partner slot.
export function checkAnswer(c: AnswerCheck, answer: "accept" | "decline"): AnswerRefusal | null {
  if (normalizeEmail(c.inviteeEmail) !== normalizeEmail(c.userEmail)) return "not_yours";
  if (c.status !== "pending") return "answered";
  if (answer === "decline") return null;
  if (c.userPaired) return "you_paired";
  if (c.inviterPaired) return "inviter_paired";
  return null;
}

// Only the inviter cancels, and only while nobody has answered.
export function canCancel(invite: { status: InviteStatus; inviterId: string }, userId: string): boolean {
  return invite.status === "pending" && invite.inviterId === userId;
}

export const DISSOLVE_REFUSED = "Kör közben nem lehet megszüntetni a párt, csak két kör között.";

// Either player may dissolve an active pair, except while it is in a group
// of a running phase. Until groups exist (#24) it is always allowed.
export function canDissolve(
  pair: { status: "active" | "dissolved"; playerA: string; playerB: string },
  userId: string,
  inRunningGroup: boolean,
): boolean {
  if (pair.status !== "active") return false;
  if (pair.playerA !== userId && pair.playerB !== userId) return false;
  return !inRunningGroup;
}

export function invitePath(token: string): string {
  return `/pair/invite/${token}`;
}

// The emailed link. An invitee without an account goes through the login page
// first, with the address filled in, and comes back to the invite (D14).
export function inviteLink(siteUrl: string, token: string, invitee: { email: string; hasAccount: boolean }): string {
  if (invitee.hasAccount) return `${siteUrl}${invitePath(token)}`;
  const q = new URLSearchParams({ email: invitee.email, returnTo: invitePath(token) });
  return `${siteUrl}/login?${q}`;
}

// The invite token from the URL: what randomToken() makes (base64url).
export function isInviteToken(value: string | undefined): value is string {
  return !!value && /^[A-Za-z0-9_-]{43}$/.test(value);
}

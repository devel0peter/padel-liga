// The partner a player named on the interest form (#89, D26-D27). Pure (no
// I/O); the D1 side is signup-partners.server.ts.
//
// For the first season everyone starts with the partner they signed up with:
// the other address of a pair signup, or the solo a Szervező paired them with
// (both solo rows point at each other with paired_with). Withdrawn signups
// count for nothing.

import { isValidEmail, normalizeEmail } from "./auth/rules";
import type { SignupRow } from "./signups-admin";

export type SignupLink = Pick<
  SignupRow,
  "id" | "mode" | "city" | "status" | "name1" | "email1" | "name2" | "email2" | "pairedWith" | "createdAt"
>;

export type SignupPartner = { city: string; name: string; email: string };

const lower = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

// The solo this row was paired with, if both rows still point at each other.
function soloPartner<T extends SignupLink>(row: T, byId: ReadonlyMap<number, T>): T | undefined {
  if (row.mode !== "solo" || row.pairedWith == null) return undefined;
  const other = byId.get(row.pairedWith);
  if (!other || other.mode !== "solo" || other.pairedWith !== row.id || other.status === "withdrawn") return undefined;
  return other;
}

// The partner the signups name for this (any case) email, one per city: the
// address's newest signup there decides (as for the level prefill), so a
// newer solo signup or a pair signup without the partner's email names
// nobody, even if an older one did. Their own signups (as the signer) come
// before those where someone else entered them as the partner: nobody can
// override what a player said themselves. A partner entered without an email
// can't be matched to an account.
export function signupPartners(rows: readonly SignupLink[], email: string): SignupPartner[] {
  const me = lower(email);
  if (!me) return [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const own = (r: SignupLink) => (lower(r.email1) === me ? 0 : 1);
  const ordered = [...rows].sort(
    (a, b) => own(a) - own(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id,
  );
  const decided = new Set<string>();
  const out: SignupPartner[] = [];
  for (const r of ordered) {
    if (r.status === "withdrawn" || decided.has(r.city)) continue;
    let partner: { name: string | null; email: string | null };
    if (r.mode === "pair" && lower(r.email1) === me) partner = { name: r.name2, email: r.email2 };
    else if (r.mode === "pair" && lower(r.email2) === me) partner = { name: r.name1, email: r.email1 };
    else if (r.mode === "solo" && lower(r.email1) === me) {
      const other = soloPartner(r, byId);
      partner = { name: other?.name1 ?? null, email: other?.email1 ?? null };
    } else continue;
    decided.add(r.city);
    const e = lower(partner.email);
    if (e && e !== me) out.push({ city: r.city, name: (partner.name ?? "").trim(), email: e });
  }
  return out;
}

// "/pair" while the signup partner hasn't registered: their name only, never
// their email.
export function waitingMessage(name: string): string {
  return `A párod, ${name}, még nem regisztrált.`;
}

export type MissingPartnerEmail = { signupId: number; city: string; name: string };

// "Partner has no email" (#96, D35): per city, the player's own newest signup
// (as the signer) decides; if it is a pair signup naming a partner without an
// email, the player may add the address. The partner's name only.
export function partnerWithoutEmail(rows: readonly SignupLink[], email: string): MissingPartnerEmail[] {
  const me = lower(email);
  if (!me) return [];
  const own = rows
    .filter((r) => r.status !== "withdrawn" && lower(r.email1) === me)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime() || b.id - a.id);
  const decided = new Set<string>();
  const out: MissingPartnerEmail[] = [];
  for (const r of own) {
    if (decided.has(r.city)) continue;
    decided.add(r.city);
    const name = (r.name2 ?? "").trim();
    if (r.mode === "pair" && !lower(r.email2) && name) out.push({ signupId: r.id, city: r.city, name });
  }
  return out;
}

export type PartnerEmailRefusal = "email" | "self" | "paired";

export const PARTNER_EMAIL_REFUSALS: Record<PartnerEmailRefusal, string> = {
  email: "Adj meg egy érvényes e-mail-címet.",
  self: "A saját címedet nem adhatod meg.",
  paired: "Ezzel a címmel már van pár ebben a ligában.",
};

// The address typed in the box: valid, not the player's own, and not of
// someone already in an active pair in that league.
export function checkPartnerEmail(c: { email: string; userEmail: string; paired: boolean }): { ok: true; email: string } | { ok: false; error: string } {
  const email = normalizeEmail(c.email);
  if (!isValidEmail(email)) return { ok: false, error: PARTNER_EMAIL_REFUSALS.email };
  if (email === normalizeEmail(c.userEmail)) return { ok: false, error: PARTNER_EMAIL_REFUSALS.self };
  if (c.paired) return { ok: false, error: PARTNER_EMAIL_REFUSALS.paired };
  return { ok: true, email };
}

// Whether a solo signup has a partner yet (a solo still waiting gets the
// registration invite with its own text, D34).
export function soloIsPaired<T extends SignupLink>(row: T, byId: ReadonlyMap<number, T>): boolean {
  return !!soloPartner(row, byId);
}

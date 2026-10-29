// Pairs (spec section 4). Pure (no I/O) so every rule is unit tested; the D1
// side is pairs.server.ts.
//
// Players start with the partner they signed up with (#89). Every other
// change is an organizer task (#97): a Szervező of the league or the Admin
// creates, dissolves and changes pairs on the Párok page. A player is in at
// most one active pair per league. A pair can't be dissolved or changed while
// it plays in a published group whose round hasn't reached its deadline.

export type PairSource = "signup" | "manual";

export const SOURCE_LABELS: Record<PairSource, string> = {
  signup: "jelentkezésből",
  manual: "kézzel",
};

export const DISSOLVE_REFUSED = "Kör közben nem bontható fel: a pár kihirdetett csoportban játszik a kör határidejéig.";

// Párom for a player with no pair, no signup partner waiting and no partner
// address to add: a new account without a signup (#113), or a solo. A
// Szervező pairs them on the Párok page; the contact address follows the text.
export const NO_PAIR_TITLE = "Még nincs párod.";
export const NO_PAIR_TEXT = "A szervező keres neked párt. Ha már tudod, kivel játszanál, vagy kérdésed van, írj nekünk:";

export type NewPairRefusal = "same" | "unknown" | "paired";

export const NEW_PAIR_REFUSALS: Record<NewPairRefusal, string> = {
  same: "Két különböző játékost válassz.",
  unknown: "Csak regisztrált játékost választhatsz.",
  paired: "Egyikük már párban van ebben a ligában.",
};

export type NewPairCheck = {
  a: string;
  b: string;
  // Both have an account and finished the first-login page.
  registered: boolean;
  // Either is in an active pair of the league.
  paired: boolean;
};

// Whether a Szervező may put these two players in a pair.
export function checkNewPair(c: NewPairCheck): NewPairRefusal | null {
  if (!c.a || !c.b || c.a === c.b) return "same";
  if (!c.registered) return "unknown";
  if (c.paired) return "paired";
  return null;
}

// "Felbontás" and "Partner cseréje": only an active pair, and not while it
// is in a published group whose round hasn't ended (#24).
export function canDissolve(pair: { status: "active" | "dissolved" }, inRunningGroup: boolean): boolean {
  return pair.status === "active" && !inRunningGroup;
}

// Pairs (spec section 4). Pure (no I/O) so every rule is unit tested; the D1
// side is pairs.server.ts.
//
// Players start with the partner they signed up with (#89), or invite one
// with their own pair link (2026-10-31). Every other change is an organizer
// task (#97): a Szervező of the league or the Admin creates, dissolves and
// changes pairs on the Párok page. A player is in at
// most one active pair per league. A pair can't be dissolved or changed while
// it plays in a published group whose round hasn't reached its deadline.

export type PairSource = "signup" | "manual" | "link";

export const SOURCE_LABELS: Record<PairSource, string> = {
  signup: "jelentkezésből",
  manual: "kézzel",
  link: "linkkel",
};

export const DISSOLVE_REFUSED = "Kör közben nem bontható fel: a pár kihirdetett csoportban játszik a kör határidejéig.";

// Párom for a player with no pair, under the pair link: those with nobody
// to invite (a new account without a signup, #113, or a solo) are paired by
// a Szervező on the Párok page; the contact address follows the text.
export const NO_PAIR_TEXT = "Ha nincs kivel játszanod, a szervező keres neked párt. Kérdés esetén írj nekünk:";

// The pair link (2026-10-31): the box on /home and /pair while the player
// has no pair in the league.
export const PAIR_LINK_TITLE = "Hívd meg a párodat";
export const PAIR_LINK_TEXT =
  "Küldd el neki ezt a linket (Messenger, SMS, bárhol). Ha megnyitja, regisztrál és elfogadja, már párban is vagytok, és nevezhettek.";
// On /pair after "Elfogadom".
export const PAIR_LINK_ACCEPTED = "Mostantól párban vagytok. Már nevezhettek is.";
export const PAIR_LINK_SHARE_TEXT = "Legyél a párom a Padelpárbajon! Itt tudsz csatlakozni:";

export type PairLinkRefusal = "own" | "you_paired" | "owner_paired";

export const PAIR_LINK_REFUSALS: Record<PairLinkRefusal, string> = {
  own: "Ez a saját linked. Küldd el annak, akivel játszani szeretnél.",
  you_paired: "Már van párod ebben a ligában. Ha változna, írj nekünk.",
  owner_paired: "Ő közben már párt talált, ezért ez a link most nem él.",
};

// Whether the player who opened a pair link may accept it: not their own,
// and neither of them in an active pair of the league.
export function checkPairLink(c: { ownerId: string; userId: string; userPaired: boolean; ownerPaired: boolean }): PairLinkRefusal | null {
  if (c.ownerId === c.userId) return "own";
  if (c.userPaired) return "you_paired";
  if (c.ownerPaired) return "owner_paired";
  return null;
}

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

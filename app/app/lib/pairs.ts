// Pairs (spec section 4). Pure (no I/O) so every rule is unit tested; the D1
// side is pairs.server.ts.
//
// Players start with the partner they signed up with (#89), or invite one
// with their own pair link (2026-10-31). Every other change is an organizer
// task (#97): a Szervező of the league or the Admin creates, dissolves and
// changes pairs on the Párok page. A player is in at
// most one active pair per league. A pair can't be dissolved or changed while
// it plays in a published group whose round hasn't reached its deadline.

// "search": made from Regisztráltak on Párkeresők (D113, #297).
export type PairSource = "signup" | "manual" | "link" | "search";

export const SOURCE_LABELS: Record<PairSource, string> = {
  signup: "jelentkezésből",
  manual: "kézzel",
  link: "linkkel",
  search: "Párkeresők",
};

export const DISSOLVE_REFUSED = "Nem bontható fel: a pár kihirdetett csoportban játszik a kör határidejéig.";

// The pair lives in the "Párod" section of Profil (D140, #346; a page of its
// own, "Párom" at /pair, before). /pair still leads there, query kept, for
// links in mail and notices sent before.
export const PAIR_SECTION_ID = "parod";
export const PAIR_SECTION_PATH = `/profile#${PAIR_SECTION_ID}`;

// The Párod section with a query ("?joined=1"); "" or "?" for none.
export function pairSectionUrl(search = ""): string {
  return `/profile${search === "?" ? "" : search}#${PAIR_SECTION_ID}`;
}

// Párod for a player with no pair, under the pair link and the "Párt
// keresek" switch (partner-search.ts); the contact address follows the text.
export const NO_PAIR_TEXT = "Kérdés esetén írj nekünk:";

// The header line of Párod (#124). The "if it changes" sentence is only for
// someone who has a pair; without one, the contact address is given once, by
// the card under the pair link (NO_PAIR_TEXT).
export function pairPageDescription(hasPair: boolean, contactEmail: string): string {
  const base = "Egy ligában egy párod lehet.";
  return hasPair ? `${base} Ha változna, írj nekünk: ${contactEmail}` : base;
}

// The pair link (2026-10-31): the box on /home and in Párod while the player
// has no pair in the league.
export const PAIR_LINK_TITLE = "Hívd meg a párodat";
export const PAIR_LINK_TEXT =
  "Küldd el neki ezt a linket (Messenger, SMS, bárhol). Ha megnyitja, regisztrál és elfogadja, már párban is vagytok, és nevezhettek.";
// In Párod after "Elfogadom".
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
  unknown: "Csak a liga regisztrált játékosai közül választhatsz.",
  paired: "Egyikük már párban van ebben a ligában.",
};

export type NewPairCheck = {
  a: string;
  b: string;
  // Both have an account, finished the first-login page and are the
  // league's players (D128).
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

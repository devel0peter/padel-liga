// "Párt keresek" (README decision log, 2026-11-02, D59): a registered player
// without a pair asks the organizer for a partner, per league. Pure; the D1
// side is partner-search.server.ts.

// The switch on Párom, while the player has no pair in the league.
export const PARTNER_SEARCH_TITLE = "Párt keresel?";
export const PARTNER_SEARCH_LABEL = "Párt keresek";
export const PARTNER_SEARCH_ON = "A szervező látja, hogy párt keresel, és párba tesz valakivel. A párod neve itt jelenik meg.";
export const PARTNER_SEARCH_OFF = "Ha nincs kivel játszanod, kapcsold be, és a szervező keres neked párt.";

// Whether the player is looking for a partner: what they set, or by default
// on when their solo signup is still waiting for one (they asked for a partner
// when they signed up), off for everyone else.
export function isSeeking(stored: boolean | undefined, waitingSolo: boolean): boolean {
  return stored ?? waitingSolo;
}

type Solo = { id: number; mode: "pair" | "solo"; city: string; status: string; email1: string; pairedWith: number | null };

// The solo signups of the city whose person is on by default, by lowercased
// email: not withdrawn, and either still waiting for a partner, or paired by
// a Szervező with someone who has registered too. Two registered solos form
// their pair at login (D27), so if they have none, it was dissolved or the
// partner went elsewhere; until the partner registers, the pair is pending.
export function defaultSeekers<T extends Solo>(rows: readonly T[], city: string, registered: ReadonlySet<string>): Map<string, T> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out = new Map<string, T>();
  for (const r of rows) {
    if (r.mode !== "solo" || r.city !== city || r.status === "withdrawn") continue;
    const partner = r.pairedWith == null ? null : byId.get(r.pairedWith);
    if (r.pairedWith == null || !partner || registered.has(partner.email1.toLowerCase())) out.set(r.email1.toLowerCase(), r);
  }
  return out;
}

// A registered player's solo signup in the city, by lowercased email (not
// withdrawn; the newest wins): the home club shown for a pair from
// Regisztráltak in Összehozott párok (#297), as Regisztráltak showed it.
export function soloSignupsByEmail<T extends Solo>(rows: readonly T[], city: string): Map<string, T> {
  const out = new Map<string, T>();
  for (const r of rows) {
    if (r.mode !== "solo" || r.city !== city || r.status === "withdrawn") continue;
    const key = r.email1.toLowerCase();
    const seen = out.get(key);
    if (!seen || seen.id < r.id) out.set(key, r);
  }
  return out;
}

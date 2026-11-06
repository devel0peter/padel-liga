// "Párt keresek" (decision log, 2026-11-02, D59): a registered player
// without a pair asks the organizer for a partner, per league. Pure; the D1
// side is partner-search.server.ts.

// The switch on Párom, while the player has no pair in the league.
export const PARTNER_SEARCH_TITLE = "Párt keresel?";
export const PARTNER_SEARCH_LABEL = "Párt keresek";
export const PARTNER_SEARCH_ON = "A szervező látja, hogy párt keresel, és párba tesz valakivel. A párod neve itt jelenik meg.";
export const PARTNER_SEARCH_OFF = "Ha nincs kivel játszanod, kapcsold be, és a szervező keres neked párt.";

// Whether the player is looking for a partner: what they set; off until they
// switch it on (#333, D128: no default from the interest list any more; the
// release stored the old default as a row, so nobody's setting changed).
export function isSeeking(stored: boolean | undefined): boolean {
  return stored ?? false;
}

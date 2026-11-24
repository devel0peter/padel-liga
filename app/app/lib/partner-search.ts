import { budapestDay, daysBetween } from "@padel-liga/rules";

import { dialable } from "./matches";
import { levelLabel } from "./signups-admin";

// "Párt keresek" (decision log, 2026-11-02, D59): a registered player without
// a pair asks the organizer for a partner, per league. Párkereső (D177, #398):
// seekers of a league who switched it on under the wording below see each
// other, with phone and email, on the league's Ligáim card. Pure; the D1 side
// is partner-search.server.ts.

// The switch on Kezdőlap and Párod, while the player has no pair in the league.
export const PARTNER_SEARCH_TITLE = "Párt keresel?";
export const PARTNER_SEARCH_LABEL = "Párt keresek";
// What the switch shares, and with whom (#398, requirement 7): everything
// Párkereső shows. The league's players without a pair see the list too,
// without contact data.
const SHARED =
  "a szervező és a liga többi párkeresője látja a neved, a szinted, az Élő-pontod, azt, hogy mióta keresel, a telefonszámod és az e-mail-címed; a liga többi pár nélküli játékosa ugyanezt, telefonszám és e-mail-cím nélkül";
export const PARTNER_SEARCH_ON = `Bekapcsolva: ${SHARED}. Bármikor kikapcsolhatod.`;
// Over "Bekapcsolom a párkeresést": what the button shares.
export const FINDER_SHARES = `Ha bekapcsolod, ${SHARED}. Bármikor kikapcsolhatod.`;
export const PARTNER_SEARCH_OFF = `Kapcsold be, és megtaláljátok egymást a Párkeresőben: ${SHARED}. A szervező is párba tehet valakivel. Bármikor kikapcsolhatod.`;
// On from before #398: the organizer sees it, the other seekers don't (D177).
export const PARTNER_SEARCH_ORGANIZER_ONLY =
  "Most csak a szervező látja, hogy párt keresel. Ha szeretnéd, hogy a Párkeresőben a liga többi párkeresője is lásson (név, szint, Élő-pont, telefonszám, e-mail-cím), kapcsold be újra:";

// Párkereső, the section of the league's Ligáim card (#398).
export const FINDER_TITLE = "Párkereső";
export const FINDER_ID = "parkereso";
export const FINDER_PAIRED = "Neked már van párod.";
export const FINDER_SWITCH_ON = "Bekapcsolom a párkeresést";
export const FINDER_EMPTY = "Most rajtad kívül senki sem keres párt ebben a ligában.";
export const FINDER_LOCKED = "Az elérhetőségüket akkor látod, ha te is bekapcsolod a párkeresést: ők is a tiédet.";
export const FINDER_OPEN = "Nézd meg a Párkeresőt";
// Inside a sentence: "Nincs párod. Hívd meg a párodat, vagy nézd meg a Párkeresőt."
export const FINDER_OPEN_INLINE = "nézd meg a Párkeresőt";

/** The league's Párkereső: the section of its card on Ligáim. */
export const finderPath = (leagueSlug: string | undefined) => (leagueSlug ? `/leagues/${leagueSlug}#${FINDER_ID}` : undefined);

// Whether the player is looking for a partner: what they set; off until they
// switch it on (#333, D129: no default from the interest list any more; the
// release stored the old default as a row, so nobody's setting changed).
export function isSeeking(stored: boolean | undefined): boolean {
  return stored ?? false;
}

/**
 * The switch's state in a league. `listed`: switched on under the #398
 * wording, so Párkereső shows the player to the league's other seekers; a
 * switch on from before isn't listed (D177).
 */
export type SearchState = { seeking: boolean; listed: boolean };

export function searchState(stored: { seeking: boolean; listed: boolean } | undefined): SearchState {
  const seeking = isSeeking(stored?.seeking);
  return { seeking, listed: seeking && !!stored?.listed };
}

/** A listed seeker as the D1 side reads them; `phone` and `email` only for a viewer who is listed too. */
export type FinderRow = {
  id: string;
  name: string;
  level: string | null;
  elo: number | null;
  since: Date;
  phone?: string | null;
  email?: string | null;
};

/** One seeker on Párkereső. `contact`: null unless the viewer is a listed seeker too (mutual, #398). */
export type FinderEntry = {
  id: string;
  name: string;
  level: string;
  /** Rounded; null until they played a rated match. */
  elo: number | null;
  /** "ma óta keres", "3 napja keres". */
  looking: string;
  contact: { phone: string | null; email: string } | null;
};

/** Tap to call, send an SMS or write, in the player's own apps; null without a phone. */
export function contactLinks(contact: { phone: string | null; email: string }): { tel: string | null; sms: string | null; mailto: string } {
  const number = contact.phone ? dialable(contact.phone) : "";
  return { tel: number ? `tel:${number}` : null, sms: number ? `sms:${number}` : null, mailto: `mailto:${contact.email}` };
}

/** How long they have been looking, in Budapest calendar days. */
export function lookingText(since: Date, now: Date): string {
  const days = Math.max(0, daysBetween(budapestDay(since), budapestDay(now)));
  if (days === 0) return "ma óta keres";
  if (days === 1) return "tegnap óta keres";
  return `${days} napja keres`;
}

/**
 * Párkereső's list for one viewer: the other listed seekers, newest first.
 * Phone and email only when the viewer is a listed seeker too; the server
 * doesn't even read them otherwise, this keeps the rule in one tested place.
 */
export function finderEntries(rows: readonly FinderRow[], viewer: { id: string; listed: boolean }, now: Date): FinderEntry[] {
  return rows
    .filter((r) => r.id !== viewer.id)
    .sort((a, b) => b.since.getTime() - a.since.getTime() || a.name.localeCompare(b.name, "hu"))
    .map((r) => ({
      id: r.id,
      name: r.name || "Névtelen",
      level: r.level ? levelLabel(r.level) : "",
      elo: r.elo === null ? null : Math.round(r.elo),
      looking: lookingText(r.since, now),
      contact: viewer.listed && r.email ? { phone: r.phone ?? null, email: r.email } : null,
    }));
}

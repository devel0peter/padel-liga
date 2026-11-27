// Names in two parts and team labels (#419, D182, spec 4). Pure, so every
// rule is unit tested (names.test.ts).
//
// An account stores its surname and first name as the player typed them
// ("Vezetéknév", "Keresztnév"), and the full name `name` = "<surname>
// <first_name>" for every page that names a player. A pair shows as its two
// surnames, "Kovács / Nagy"; a player without a surname (not filled yet)
// shows the full name. Two players shown together with the same surname
// both get their first name's initial ("Nagy B. / Nagy D.").

import { DELETED_NAME } from "./account-deletion";

/**
 * A player as a page names them: the full name, the two parts (users.surname,
 * users.first_name; null when not filled) and the account id where the page
 * has one (two different players with the same name are then still two).
 */
export type NamedPlayer = { id?: string | null; name: string; surname?: string | null; firstName?: string | null };

// What an empty name shows (the pages' existing fallback).
const NAMELESS = "Névtelen";

// How names compare: NFC, lowercased.
const key = (word: string) => word.normalize("NFC").toLocaleLowerCase("hu");

/** The full name from its two parts: "Kovács Anna". */
export const fullName = (surname: string, firstName: string) => `${surname} ${firstName}`;

/** Kezdőlap's greeting: "Szia, Anna!" with the first name when there is one, else "Szia!". */
export function greeting(firstName: string | null | undefined): string {
  const first = firstName?.trim();
  return first ? `Szia, ${first}!` : "Szia!";
}

// Hungarian initials keep a double letter: "Zs." for Zsolt, "Gy." for
// György, "Dzs." for Dzsenifer.
const DIGRAPHS = ["dzs", "cs", "dz", "gy", "ly", "ny", "sz", "ty", "zs"];

/** "B." for Béla, "Zs." for Zsófia. */
export function initial(firstName: string): string {
  const k = key(firstName.trim());
  const length = DIGRAPHS.find((d) => k.startsWith(d))?.length ?? 1;
  const letters = [...firstName.trim().normalize("NFC")].slice(0, length).join("");
  return `${letters.charAt(0).toLocaleUpperCase("hu")}${letters.slice(1).toLocaleLowerCase("hu")}.`;
}

// A surname a label can show: set, and not an anonymized account.
const surnameOf = (p: NamedPlayer) => (p.name !== DELETED_NAME && p.surname?.trim() ? p.surname.trim() : null);

// Who a player is for the clash rule: the account, else the full name.
const identity = (p: NamedPlayer) => (p.id ? `id:${p.id}` : `name:${key(p.name.trim())}`);

/**
 * Builds the labels of the pairs on one screen (a group, a match, a list):
 * `shown` is every player the screen names. A player shows their surname,
 * or the full name while they have none. Two different players there with
 * the same surname both get their first name's initial ("Nagy B."), and the
 * whole first name when the initials are the same too ("Nagy Béla", "Nagy
 * Bence"). One player shown twice is no clash. A deleted account keeps
 * "Törölt játékos", an empty name "Névtelen".
 */
export function teamLabeler(shown: readonly NamedPlayer[]): (pair: readonly NamedPlayer[]) => string {
  // Distinct players with a surname, grouped by it.
  const bySurname = new Map<string, Map<string, string>>();
  for (const p of shown) {
    const surname = surnameOf(p);
    if (!surname) continue;
    const players = bySurname.get(key(surname)) ?? bySurname.set(key(surname), new Map()).get(key(surname))!;
    players.set(identity(p), p.firstName?.trim() ?? "");
  }
  const extra = new Map<string, string>();
  for (const players of bySurname.values()) {
    if (players.size < 2) continue;
    const initials = new Map<string, number>();
    for (const first of players.values()) {
      const i = first ? key(initial(first)) : "";
      initials.set(i, (initials.get(i) ?? 0) + 1);
    }
    for (const [id, first] of players) if (first) extra.set(id, initials.get(key(initial(first)))! > 1 ? first : initial(first));
  }
  const short = (p: NamedPlayer) => {
    const surname = surnameOf(p);
    if (!surname) return p.name || NAMELESS;
    const more = extra.get(identity(p));
    return more ? `${surname} ${more}` : surname;
  };
  return (pair) => pair.map(short).join(" / ");
}

/** One pair's label on its own: "Kovács / Nagy", or "Nagy B. / Nagy D." for two Nagys. */
export const teamLabel = (pair: readonly NamedPlayer[]): string => teamLabeler(pair)(pair);

/** The labels of pairs shown together, in order (teamLabeler over all their players). */
export function teamLabels(pairs: readonly (readonly NamedPlayer[])[]): string[] {
  const label = teamLabeler(pairs.flat());
  return pairs.map(label);
}

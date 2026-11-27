// Surnames, given names and team labels (#419, D182, spec 4). Pure, so
// every rule is unit tested (names.test.ts).
//
// An account stores one full name. The surname is worked out from the
// official Hungarian given-name list (given-names.ts), or is the part the
// player picked (users.surname). A pair shows as "Kovács / Nagy"; two
// players shown together who share a surname both get their given-name
// initial ("Nagy B. / Nagy D.").

import { DELETED_NAME } from "./account-deletion";
import { isListedGivenName } from "./given-names";

/** A player as a page names them: the stored full name and the surname they picked (users.surname, null: the rules decide). */
export type NamedPlayer = { name: string; surname?: string | null };

// What an empty name shows (the pages' existing fallback).
const NAMELESS = "Névtelen";

// Titles before a name, never a part of it: "dr. Kovács Anna".
const PREFIXES = new Set(["dr", "ifj", "id", "özv", "prof"]);

// How words compare: NFC, lowercased.
const key = (word: string) => word.normalize("NFC").toLocaleLowerCase("hu");

/** Whether two words are the same name part, whatever their case or Unicode form. */
export const sameWord = (x: string, y: string) => key(x) === key(y);

const isPrefix = (word: string) => PREFIXES.has(key(word).replace(/\.$/, ""));

/** Whether a word is a given name on the list; a hyphenated one when every part is ("Anna-Mária"), so "Kiss-Nagy" is not. */
export function isGivenName(word: string): boolean {
  const k = key(word);
  return isListedGivenName(k) || (k.includes("-") && k.split("-").every((part) => part !== "" && isListedGivenName(part)));
}

// The married form "Kovács Péterné": the husband's given name with -né.
const isMarriedForm = (word: string) => key(word).endsWith("né") && !isGivenName(word);

/** The words of a name as written (NFC), without the leading titles; a hyphenated surname is one word. */
export function nameParts(name: string): string[] {
  const words = name.normalize("NFC").trim().split(/\s+/).filter(Boolean);
  let first = 0;
  while (first < words.length - 1 && isPrefix(words[first]!)) first++;
  return words.slice(first);
}

/**
 * The surname by the rules alone (issue #419, requirement 1). `sure`: the
 * rules found it without asking the player. `index`: its place in
 * nameParts(name), -1 for an empty name.
 */
export function surnameByRules(name: string): { surname: string; index: number; sure: boolean } {
  const parts = nameParts(name);
  const at = (index: number, sure: boolean) => ({ surname: parts[index] ?? "", index: parts.length === 0 ? -1 : index, sure });
  if (parts.length <= 1) return at(0, false);
  const last = parts.length - 1;
  // "Kovács Péterné": the first word.
  if (isMarriedForm(parts[last]!)) return at(0, true);
  const firstGiven = isGivenName(parts[0]!);
  // Hungarian order: "Kovács Anna", "Kovács Anna Mária".
  if (!firstGiven && parts.slice(1).some(isGivenName)) return at(0, true);
  // Western order: "Anna Kovács".
  if (firstGiven && !isGivenName(parts[last]!)) return at(last, true);
  // Both ("Farkas Lilla") or neither: the first word, until the player says.
  return at(0, false);
}

/** What the pages know about a player's name. */
export type NameInfo = {
  /** The name's parts (nameParts): the chips of "Neved a tabellában". */
  parts: string[];
  /** The surname as written in the name; "Névtelen" for an empty name. */
  surname: string;
  /** The given name for the greeting and the initial; null when the name has none of its own (one word, "Kovács Péterné"). */
  given: string | null;
  /** The rules found the surname without asking. */
  sure: boolean;
  /** The player picked the surname (users.surname is one of the parts). */
  confirmed: boolean;
};

/**
 * A player's name worked out: the surname they picked when it is still one
 * of their name's parts (a stale pick is ignored), else the rules' one.
 */
export function nameInfo(player: NamedPlayer): NameInfo {
  const parts = nameParts(player.name);
  const ruled = surnameByRules(player.name);
  const picked = player.surname ? parts.findIndex((p) => sameWord(p, player.surname!)) : -1;
  const index = picked >= 0 ? picked : ruled.index;
  if (index < 0) return { parts, surname: NAMELESS, given: null, sure: false, confirmed: false };
  const rest = parts.filter((_, i) => i !== index);
  // A listed given name first ("Kovácsné Szabó Anna": Anna); a -né word is
  // the husband's name, not the player's own.
  const given = rest.find(isGivenName) ?? rest.find((p) => !isMarriedForm(p)) ?? null;
  return { parts, surname: parts[index]!, given, sure: ruled.sure, confirmed: picked >= 0 };
}

/** Whether Kezdőlap asks the player which part is their surname: unsure and not yet answered (issue #419, requirement 7). */
export const asksSurname = (player: NamedPlayer): boolean => {
  const info = nameInfo(player);
  return !info.sure && !info.confirmed && info.parts.length > 1;
};

/** Kezdőlap's greeting: "Szia, Anna!" only when the name is sure or confirmed, else "Szia!". */
export function greeting(player: NamedPlayer): string {
  const info = nameInfo(player);
  return (info.sure || info.confirmed) && info.given ? `Szia, ${info.given}!` : "Szia!";
}

// Hungarian initials keep a double letter: "Zs." for Zsolt, "Gy." for
// György, "Dzs." for Dzsenifer.
const DIGRAPHS = ["dzs", "cs", "dz", "gy", "ly", "ny", "sz", "ty", "zs"];

/** "B." for Béla, "Zs." for Zsófia. */
export function initial(given: string): string {
  const k = key(given);
  const length = DIGRAPHS.find((d) => k.startsWith(d))?.length ?? 1;
  const letters = [...given.normalize("NFC")].slice(0, length).join("");
  return `${letters.charAt(0).toLocaleUpperCase("hu")}${letters.slice(1).toLocaleLowerCase("hu")}.`;
}

/**
 * Builds the labels of the pairs on one screen (a group, a match, a list):
 * `shown` is every player the screen names. Two different players there who
 * share a surname both get their given-name initial ("Nagy B."), and their
 * whole given name when the initials are the same too ("Nagy Béla", "Nagy
 * Bence"). One player shown twice is no clash. A deleted account keeps
 * "Törölt játékos".
 */
export function teamLabeler(shown: readonly NamedPlayer[]): (pair: readonly NamedPlayer[]) => string {
  // Distinct players by full name, grouped by surname.
  const bySurname = new Map<string, Map<string, NameInfo>>();
  for (const p of shown) {
    if (p.name === DELETED_NAME) continue;
    const info = nameInfo(p);
    const players = bySurname.get(key(info.surname)) ?? bySurname.set(key(info.surname), new Map()).get(key(info.surname))!;
    players.set(key(p.name.trim()), info);
  }
  const extra = new Map<string, string>();
  for (const players of bySurname.values()) {
    if (players.size < 2) continue;
    // The given name, or the rest of the name when it has none of its own ("Kovács Péterné").
    const own = (info: NameInfo) => info.given ?? info.parts.find((p) => key(p) !== key(info.surname)) ?? "";
    const initials = new Map<string, number>();
    for (const info of players.values()) {
      const i = own(info) ? key(initial(own(info))) : "";
      initials.set(i, (initials.get(i) ?? 0) + 1);
    }
    for (const [name, info] of players) {
      const given = own(info);
      if (!given) continue;
      extra.set(name, initials.get(key(initial(given)))! > 1 ? given : initial(given));
    }
  }
  const short = (p: NamedPlayer) => {
    if (p.name === DELETED_NAME) return DELETED_NAME;
    const surname = nameInfo(p).surname;
    const more = extra.get(key(p.name.trim()));
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

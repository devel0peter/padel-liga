// Where a player stands, as the admin tables show it (player-status.server.ts
// builds it). Pure, so the wording is unit tested.

import { ENTRY_STATUS_LABELS, type EntryStatus } from "./season-entries";

export type PlayerPair = {
  leagueId: number;
  league: string;
  city: string;
  partner: string;
  // The pair's entry in the league's current or next season, if any.
  entry: { season: string; status: EntryStatus } | null;
  // The league's first home season, or null when it has none.
  season: string | null;
};

export type PlayerStatus = {
  // The first-login page is done (name, consent): the account can play.
  registered: boolean;
  level: string | null;
  // A phone number was given; the number itself is never in here.
  phone: boolean;
  // Active pairs, one per league at most.
  pairs: PlayerPair[];
};

export type StatusTone = "ok" | "todo" | "muted";
export type StatusChip = { text: string; tone: StatusTone };

// The account chip: no account, first-login page not finished, or registered.
export function accountChip(status: PlayerStatus | undefined): StatusChip {
  if (!status) return { text: "Nincs fiókja", tone: "muted" };
  return status.registered ? { text: "Regisztrált", tone: "ok" } : { text: "Félbehagyta a regisztrációt", tone: "todo" };
}

// What's missing for the league: level (the starting Elo) and phone number
// (opponents will need it). Only for registered accounts.
export function missingChips(status: PlayerStatus | undefined): StatusChip[] {
  if (!status?.registered) return [];
  const chips: StatusChip[] = [];
  if (!status.level) chips.push({ text: "Nincs szintje", tone: "todo" });
  if (!status.phone) chips.push({ text: "Nincs telefonszáma", tone: "todo" });
  return chips;
}

// The pair chips for the given leagues (all when `leagueIds` is undefined):
// "Pár: Béla" and the entry, or "Nincs párja" for a registered player with
// none. `withLeague`: prefix the league name (more than one league shown).
export function pairChips(
  status: PlayerStatus | undefined,
  leagueIds?: readonly number[],
  withLeague = false,
): StatusChip[] {
  if (!status?.registered) return [];
  const mine = status.pairs.filter((p) => !leagueIds || leagueIds.includes(p.leagueId));
  if (mine.length === 0) return leagueIds && leagueIds.length === 0 ? [] : [{ text: "Nincs párja", tone: "todo" }];
  return mine.flatMap((p) => {
    const prefix = withLeague ? `${p.league}: ` : "";
    const chips: StatusChip[] = [{ text: `${prefix}Pár: ${p.partner}`, tone: "ok" }];
    const entry = entryChip(p);
    if (entry) chips.push(entry);
    return chips;
  });
}

// Every chip of one player, in order: account, what's missing, pairs.
export function statusChips(
  status: PlayerStatus | undefined,
  leagueIds?: readonly number[],
  withLeague = false,
): StatusChip[] {
  return [accountChip(status), ...missingChips(status), ...pairChips(status, leagueIds, withLeague)];
}

// "Nevezés (Tél): Függőben", or "Nem nevezett (Tél)" while the league has a
// home season; nothing without one.
export function entryChip(p: Pick<PlayerPair, "entry" | "season">): StatusChip | null {
  if (p.entry)
    return {
      text: `Nevezés (${p.entry.season}): ${ENTRY_STATUS_LABELS[p.entry.status]}`,
      tone: p.entry.status === "approved" ? "ok" : p.entry.status === "pending" ? "todo" : "muted",
    };
  return p.season ? { text: `Nem nevezett (${p.season})`, tone: "todo" } : null;
}

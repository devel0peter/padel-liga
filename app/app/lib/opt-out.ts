// Default in, and "Nem folytatom" on Ligáim (#395, spec 4 and 10, D176).
// Every entered pair plays on into the next round by itself; either player
// of a pair that plays the running round can opt out of the next one until
// the round's deadline (Sunday 23:59 Budapest), and the one who opted out
// can take it back ("Mégis folytatom") until then. The running round doesn't
// change: its matches count and its deadline rules apply. The round switch
// leaves the pair out as "nem folytatja" (packages/rules leaveReason). Pure,
// so every rule is unit tested; the D1 side is opt-out.server.ts.

import { formatClockTime, formatShortDate } from "./format";
import { withArticle } from "./groups";
import type { Message } from "./notifications";
import type { StoredPhase } from "./seasons";

export const OPT_OUT = "Nem folytatom";
export const UNDO_OPT_OUT = "Mégis folytatom";
export const CANCEL = "Mégse";

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// The ending of "7-től", "3-tól", "20-tól": a day number read as a cardinal
// ("héttől", "háromtól", "húsztól"), as the issue's copy has it.
function fromEnding(day: number): string {
  if (day % 10 === 0) return day === 10 ? "től" : "tól";
  return [3, 6, 8].includes(day % 10) ? "tól" : "től";
}

/** From which day, in brackets: "dec. 7-től". */
export function formatFromDate(date: Date): string {
  const short = formatShortDate(date).replace(/\.$/, "");
  const day = Number(short.match(/(\d+)$/)?.[1]);
  return `${short}-${fromEnding(day)}`;
}

/** Until when, to the minute: "dec. 6., 23:59-ig". */
export function formatUntilTime(date: Date): string {
  return `${formatShortDate(date)}, ${formatClockTime(date)}-ig`;
}

/** The running round a pair can opt out of the next one in, and the next round's start. */
export type OptOutWindow = { round: number; deadline: Date; nextRound: number; nextStart: Date };

/**
 * The window, or null: the pair plays the running round (`playing`: the
 * rounds where it has a published group it isn't withdrawn from), the round
 * has started and its deadline hasn't passed, and a next round follows (not
 * in the season's last round: season re-entry is #50).
 */
export function optOutWindow(phases: readonly StoredPhase[], playing: readonly number[], now: Date): OptOutWindow | null {
  const running = phases.find((p) => playing.includes(p.number) && p.startsAt <= now && now <= p.deadline);
  if (!running) return null;
  const next = phases.find((p) => p.number === running.number + 1);
  if (!next) return null;
  return { round: running.number, deadline: running.deadline, nextRound: next.number, nextStart: next.startsAt };
}

/** The pair's entry as far as opting out goes: the round it opted out in (null: default in) and who did. */
export type OptOutEntry = { optOutPhase: number | null; optedOutBy: string | null };

/**
 * What the Ligáim card shows (#395): default in with the deadline to opt
 * out; opted out in the running round (the one who did can take it back);
 * or, after that round's deadline, that the pair doesn't play on. Null when
 * there is nothing to say (no running round to opt out of and no opt-out).
 */
export type OptOutState =
  | { kind: "in"; window: OptOutWindow }
  | { kind: "out"; window: OptOutWindow; mine: boolean }
  | { kind: "left"; round: number };

export function optOutState(window: OptOutWindow | null, entry: OptOutEntry, me: string, now: Date, phases: readonly StoredPhase[]): OptOutState | null {
  if (entry.optOutPhase !== null) {
    if (window && window.round === entry.optOutPhase) return { kind: "out", window, mine: entry.optedOutBy === me };
    const ended = phases.find((p) => p.number === entry.optOutPhase);
    return ended && ended.deadline < now ? { kind: "left", round: entry.optOutPhase } : null;
  }
  return window ? { kind: "in", window } : null;
}

/** "Benne vagytok a 2. körben (dec. 7-től). Ha nem folytatnád, jelezd dec. 6., 23:59-ig." */
export function stayInText(w: OptOutWindow): string {
  return `Benne vagytok ${withArticle(w.nextRound)} körben (${formatFromDate(w.nextStart)}). Ha nem folytatnád, jelezd ${formatUntilTime(w.deadline)}.`;
}

/** The line once opted out: to the one who did, with until when they can take it back; to the partner. */
export function optedOutText(w: OptOutWindow, mine: boolean): string {
  const after = `${withArticle(w.round)} kör után kiléptek a szezonból.`;
  return mine
    ? `Jelezted, hogy nem folytatod: ${after} Meggondolhatod ${formatUntilTime(w.deadline)}.`
    : `A párod jelezte, hogy nem folytatja: ${after}`;
}

/** After the round's deadline. */
export function leftText(round: number): string {
  return `${capitalize(withArticle(round))} kör után nem folytatjátok a szezont.`;
}

/** Párok's entry state for the organizer (#395 requirement 9): "Kilép a kör végén", then that it left. */
export function optOutEntryText(o: { round: number; ended: boolean }): string {
  return o.ended ? `Kilépett ${withArticle(o.round)} kör után` : "Kilép a kör végén";
}

/** The confirmation's title and text (#395 requirement 3): what happens, no spot promised. */
export function confirmTitle(w: OptOutWindow): string {
  return `Nem folytatod ${withArticle(w.nextRound)} körben?`;
}

export function confirmText(w: OptOutWindow): string {
  return [
    `A párotok ${withArticle(w.round)} kör után kilép a szezonból.`,
    `${capitalize(withArticle(w.round))} kör hátralévő meccsei számítanak, ezeket még le kell játszanotok.`,
    "A párod új partnerrel folytathatja.",
    `Meggondolhatod ${formatUntilTime(w.deadline)}.`,
  ].join(" ");
}

// The answers after the form.
export const OPTED_OUT = "Rendben, jelezted, hogy nem folytatod.";
export const OPT_OUT_UNDONE = "Rendben, folytatjátok.";

// Why the server refuses (a forced request, or the state changed meanwhile).
export const OPT_OUT_REFUSALS = {
  no_pair: "Ebben a ligában nincs párod.",
  not_entered: "A párotok nem nevezett erre a szezonra.",
  deadline: "Lejárt a kör határideje, ezt már nem tudod módosítani.",
  no_round: "Most nem játszotok futó kört, így nincs mit lemondani.",
  last_round: "Ez a szezon utolsó köre: nincs következő kör.",
  already: "Már jelezték, hogy nem folytatjátok.",
  not_out: "Folytatjátok, nincs mit visszavonni.",
  not_mine: "Ezt csak az vonhatja vissza, aki jelezte.",
} as const;

export type OptOutRefusal = keyof typeof OPT_OUT_REFUSALS;

/**
 * Why a player can't opt out (or take it back) now, or null. `phases`: the
 * season's rounds; `playing`: the rounds the pair has a published group in
 * (not withdrawn); `entry`: the pair's entry that counts, null without one.
 */
export function optOutRefusal(
  action: "opt_out" | "undo",
  input: { phases: readonly StoredPhase[]; playing: readonly number[]; entry: OptOutEntry | null; me: string; now: Date },
): OptOutRefusal | null {
  const { phases, playing, entry, me, now } = input;
  if (!entry) return "not_entered";
  const window = optOutWindow(phases, playing, now);
  if (!window) {
    const played = phases.filter((p) => playing.includes(p.number) && p.startsAt <= now);
    // The round the pair played (or opted out in) has ended.
    if (played.length > 0 && played.every((p) => p.deadline < now)) return "deadline";
    const running = played.find((p) => now <= p.deadline);
    if (running && !phases.some((p) => p.number === running.number + 1)) return "last_round";
    return "no_round";
  }
  if (action === "opt_out") return entry.optOutPhase === null ? null : "already";
  if (entry.optOutPhase !== window.round) return "not_out";
  return entry.optedOutBy === me ? null : "not_mine";
}

/**
 * The partner's notice (#395 requirement 8), in the app and by push, never
 * by email: "A párod nem folytatja a 2. körben, így a párotok kimarad
 * belőle." No names (a lock screen is not a private place); the partner is
 * "a párod".
 */
export function optOutMessage(input: { league: string; season: string; nextRound: number }, event: "opt_out" | "undo"): Message {
  const where = `${input.season}, ${input.league}.`;
  if (event === "undo")
    return {
      title: "A párod mégis folytatja",
      body: `A párod mégis folytatja, így ${withArticle(input.nextRound)} körben is játszotok. ${where}`,
      url: "/leagues",
    };
  return {
    title: "A párod nem folytatja",
    body: `A párod nem folytatja ${withArticle(input.nextRound)} körben, így a párotok kimarad belőle. ${where}`,
    url: "/leagues",
  };
}

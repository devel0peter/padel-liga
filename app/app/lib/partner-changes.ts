// Permanent partner change ("Állandó partnercsere", #402, spec 4, D178):
// either player of a pair names a new partner on Ligáim, the new partner
// accepts there, and from then on the change is final. The new partner plays
// the old pair's remaining matches of the running round as a substitute
// (the leaving player is marked absent, #400), and the new pair takes the
// old pair's spot at the round switch (#403, D179). Pure, so every rule is
// unit tested; the D1 side is partner-changes.server.ts. Names only: nothing
// here carries an email or phone.

import { formatUntilDate } from "./format";
import { withArticle } from "./groups";

export type PartnerChangeStatus =
  // Waiting for the new partner's answer, at most LAPSE_DAYS.
  | "open"
  | "withdrawn"
  | "declined"
  // Unanswered for LAPSE_DAYS: stored lazily (a read treats an old open row
  // as lapsed already, lapsedAt), so no cron step is needed.
  | "lapsed"
  // Accepted: final, until the new pair starts (the organizer can undo it).
  | "final"
  | "undone"
  // The new pair exists and plays: the old pair is dissolved.
  | "started";

/** An unanswered change lapses this many days after it was sent (#402). */
export const LAPSE_DAYS = 7;

const DAY_MS = 86_400_000;

/** When an open change lapses. */
export function lapsesAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + LAPSE_DAYS * DAY_MS);
}

/** The status as it holds now: an open change past LAPSE_DAYS counts as lapsed. */
export function currentStatus(c: { status: PartnerChangeStatus; createdAt: Date }, now: Date): PartnerChangeStatus {
  return c.status === "open" && now.getTime() >= lapsesAt(c.createdAt).getTime() ? "lapsed" : c.status;
}

/** A change that still holds the pair: one at a time per pair (#402 req 2). */
export function isLive(status: PartnerChangeStatus): boolean {
  return status === "open" || status === "final";
}

/**
 * When the new pair starts (#402 req 6), from where the old pair is when the
 * change becomes final:
 * - "now": the pair isn't in a published group of the season yet (it waits
 *   for its first round): the new pair takes over its entry at once.
 * - "switch": at the round switch into `phase` (#403), the phase after the
 *   newest one with groups (a draft or published), so a change made after
 *   the round switch draft starts at the following switch.
 * - "season": the season has no such phase: at the season switch (#49).
 */
export type StartsAt = { kind: "now" } | { kind: "switch"; phase: number } | { kind: "season" };

export function startsAt(input: {
  /** The season's round numbers. */
  phases: readonly number[];
  /** The rounds of the season that have groups, a draft or published. */
  withGroups: readonly number[];
  /** Whether the old pair is (or was) in a published group of the season. */
  played: boolean;
}): StartsAt {
  if (!input.played) return { kind: "now" };
  const newest = Math.max(0, ...input.withGroups);
  const next = newest + 1;
  return input.phases.includes(next) ? { kind: "switch", phase: next } : { kind: "season" };
}

/** "a 2. körtől", "a következő szezontól". */
export function startsText(phase: number | null): string {
  return phase === null ? "a következő szezontól" : `${withArticle(phase)} körtől`;
}

export type PartnerChangeRefusal =
  // Not in an active pair of the league, or the pair's entry doesn't continue.
  | "no_pair"
  // After the season's last round deadline, or no season.
  | "season_over"
  // The pair already has an open or final change.
  | "already"
  // The new partner is one of the pair, not a registered player of the
  // league, already in a pair, or named in another final change.
  | "partner"
  // The change is not open (answered, withdrawn, lapsed) or not final.
  | "not_open"
  | "not_final"
  // Only the one who sent it withdraws, only the new partner answers.
  | "not_yours";

export const PARTNER_CHANGE_REFUSALS: Record<PartnerChangeRefusal, string> = {
  no_pair: "Ehhez aktív pár és érvényes nevezés kell a szezonra.",
  season_over: "A szezon utolsó körének határideje lejárt, most már nem cserélhetsz partnert.",
  already: "Már van egy folyamatban lévő partnercseréd ebben a ligában.",
  partner: "Őt most nem hívhatod: már van párja, vagy nem játszik a ligában.",
  not_open: "Ez a kérés már nem érvényes.",
  not_final: "Ez a partnercsere már nem vonható vissza.",
  not_yours: "Ez a kérés nem a tiéd.",
};

/** Why `starter` can't start a change now, or null (#402 req 1, 2). */
export function startRefusal(c: {
  /** The starter's active pair in the league with an entry that continues in the season. */
  pair: { players: readonly string[] } | null;
  /** The season's last round deadline has not passed (a season waiting for its start counts as running). */
  seasonOpen: boolean;
  /** The pair has an open (not lapsed) or final change. */
  live: boolean;
  partnerId: string;
  /** The new partner is a registered player of the league without an active pair or a final change. */
  partnerFree: boolean;
}): PartnerChangeRefusal | null {
  if (!c.pair) return "no_pair";
  if (!c.seasonOpen) return "season_over";
  if (c.live) return "already";
  if (c.pair.players.includes(c.partnerId) || !c.partnerFree) return "partner";
  return null;
}

/** Why `userId` can't accept or decline this change now, or null. Accepting needs a still free new partner and the old pair as it was. */
export function answerRefusal(
  c: { status: PartnerChangeStatus; partnerId: string },
  userId: string,
  accept: { partnerFree: boolean; pairActive: boolean; seasonOpen: boolean } | null,
): PartnerChangeRefusal | null {
  if (c.partnerId !== userId) return "not_yours";
  if (c.status !== "open") return "not_open";
  if (!accept) return null;
  if (!accept.pairActive) return "not_open";
  if (!accept.seasonOpen) return "season_over";
  return accept.partnerFree ? null : "partner";
}

/** Why `userId` can't withdraw this change, or null: the one who sent it, while it waits. */
export function withdrawRefusal(c: { status: PartnerChangeStatus; startedBy: string }, userId: string): PartnerChangeRefusal | null {
  if (c.startedBy !== userId) return "not_yours";
  return c.status === "open" ? null : "not_open";
}

/** Why the organizer can't undo this change, or null: only a final one, before the new pair starts (#402 req 8). */
export function undoRefusal(c: { status: PartnerChangeStatus }): PartnerChangeRefusal | null {
  return c.status === "final" ? null : "not_final";
}

/** Párok's state line for the organizer (#402 req 8). */
export function changeStateText(c: { status: "open" | "final" | "started"; startsPhase: number | null; createdAt: Date }): string {
  if (c.status === "open") return `Az új partner válaszára vár, ${formatUntilDate(lapsesAt(c.createdAt))}.`;
  if (c.status === "final") return `Elfogadva. Az új pár ${startsText(c.startsPhase)} játszik, addig az új partner helyettesít.`;
  return "Az új pár már játszik.";
}

// --- Ligáim's "Állandó partnercsere" section ---------------------------------

export const SECTION_TITLE = "Állandó partnercsere";

export const START_TEXT =
  "Ha a párod végleg kiesik (sérülés, költözés), új partnerrel folytathatod a helyeteken. Az új partner a kör hátralévő meccsein helyette játszik, utána pedig ő lesz a párod.";
export const NO_CANDIDATES = "Most nincs a ligában pár nélküli játékos, akit hívhatnál.";

/** What the card shows a player about a change, by their role in it. */
// "staying": the player who started it and stays.
export type ChangeRole = "staying" | "leaving" | "partner";

export function openText(role: ChangeRole, c: { starter: string; leaving: string; partner: string; lapsesAt: Date }): string {
  const until = formatUntilDate(c.lapsesAt);
  if (role === "staying") return `Elküldted ${c.partner} részére. ${until} válaszolhat.`;
  if (role === "partner")
    return `${c.starter} állandó partnernek hív ${c.leaving} helyett. Ha elfogadod, a kör hátralévő meccsein helyettesként játszol, utána pedig párként. ${capitalize(until)} válaszolhatsz.`;
  // The other player of the pair (the one who would leave).
  return `${c.starter} állandó partnercserét kért: ${c.partner} játszana helyetted. Még nem válaszolt.`;
}

export function finalText(role: ChangeRole, c: { staying: string; leaving: string; partner: string; phase: number | null }): string {
  const from = startsText(c.phase);
  if (role === "leaving") return `${c.partner} játszik helyetted ${c.staying} mellett. ${capitalize(from)} nincs párod ebben a ligában.`;
  if (role === "partner") return `${capitalize(from)} ${c.staying} párja vagy. Addig ${c.leaving} helyett játszol a hátralévő meccseiken: az időpontokat tőle kérdezd.`;
  return `${capitalize(from)} ${c.partner} a párod. Addig ${c.leaving} helyett játszik a hátralévő meccseiteken.`;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const SENT_NOTICE = "Elküldtük. Ha elfogadja, ő játszik a párod helyett.";
export const WITHDRAWN_NOTICE = "Visszavontad a kérést.";
export const ACCEPTED_NOTICE = "Elfogadtad. A kör hátralévő meccsein te játszol helyette.";
export const DECLINED_NOTICE = "Nem fogadtad el.";

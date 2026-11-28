// The Kezdőlap's tips (#262, D160): a short card about one feature at a time,
// with a button that does it right there, until the player does it or
// dismisses it. Pure: the list, which one shows, and the dismissal rules.
// The dismissals are stored per account (tips.server.ts), the card is
// components/tip-card.tsx.

import { PUSH_NOTICES, type PushDeviceState } from "./push/device";

// What the server knows about the player.
export type TipAccount = {
  // The push channel isn't switched off on the profile (#115).
  pushChannelOn: boolean;
  // The site can push at all (VAPID keys set).
  pushConfigured: boolean;
  // The rating is due (#446): the account is at least a week old and hasn't rated yet.
  ratingDue: boolean;
};

// What this browser knows; filled in by the card once the checks are done.
export type TipDevice = {
  push: PushDeviceState;
};

// What the button does: subscribe this device to push (the same as the
// profile's push switch), open a page, or open the rating dialog (#446).
export type TipAction = { kind: "push" } | { kind: "link"; to: string } | { kind: "rating" };

export type Tip = {
  id: string;
  title: string;
  text: string;
  button: string;
  action: TipAction;
  // Checked on the server: whether the tip is offered to this account.
  offered: (account: TipAccount) => boolean;
  // Checked in the browser: whether it applies on this device now.
  applies: (device: TipDevice) => boolean;
  // How long "Most nem" hides it; TIP_SNOOZE_DAYS when not set.
  snoozeDays?: number;
};

// The tips, in order: the Kezdőlap shows the first that applies and isn't
// dismissed. Adding a tip is one entry here.
export const TIPS: readonly Tip[] = [
  {
    id: "push",
    title: "Kapj értesítést a telefonodra",
    text: "Szól, ha időpontot ajánlanak vagy eredményt kell visszaigazolnod.",
    button: "Bekapcsolom",
    action: { kind: "push" },
    offered: (a) => a.pushConfigured && a.pushChannelOn,
    // Push works in this browser and this device has no subscription. A
    // browser that blocked notifications ("denied") gets the card with how
    // to allow them, not a new prompt.
    applies: (d) => d.push === "off" || d.push === "denied",
  },
  {
    // The rating (#446): answering ends it; "Most nem" or closing it
    // unanswered hides it for 30 days, the second time for good. Not
    // logins: a login lasts 90 days, so they are too rare to count.
    id: "rating",
    title: "Hogy tetszik a Padelpárbaj?",
    text: "Értékeld egytől öt labdáig, pár másodperc az egész.",
    button: "Értékelem",
    action: { kind: "rating" },
    offered: (a) => a.ratingDue,
    applies: () => true,
    snoozeDays: 30,
  },
];

// The account's age before the rating is offered (#446).
export const RATING_AFTER_DAYS = 7;

/** Whether to offer the rating: a week after the first login, until the account rates. */
export function ratingDue(firstLoginAt: Date | null, hasRated: boolean, now: Date): boolean {
  return !hasRated && firstLoginAt !== null && now.getTime() - firstLoginAt.getTime() >= RATING_AFTER_DAYS * 86_400_000;
}

export const TIP_SNOOZE_DAYS = 14;
// The dismissal after which a tip never comes back.
export const TIP_DISMISSALS_FOR_GOOD = 2;

export type TipDismissal = { count: number; dismissedAt: Date };

// "Most nem": hidden for 14 days (or the tip's own snooze); the second time for good.
export function isDismissed(d: TipDismissal | undefined, now: Date, snoozeDays = TIP_SNOOZE_DAYS): boolean {
  if (!d) return false;
  if (d.count >= TIP_DISMISSALS_FOR_GOOD) return true;
  return now.getTime() - d.dismissedAt.getTime() < snoozeDays * 86_400_000;
}

// The tips offered to this account now, in order (the server's part).
export function offeredTips(tips: readonly Tip[], account: TipAccount, dismissals: ReadonlyMap<string, TipDismissal>, now: Date): Tip[] {
  return tips.filter((t) => t.offered(account) && !isDismissed(dismissals.get(t.id), now, t.snoozeDays));
}

// The one tip the card shows on this device: the first offered one that
// applies; none while the browser checks are running.
export function tipToShow(offered: readonly Tip[], device: TipDevice): Tip | null {
  return offered.find((t) => t.applies(device)) ?? null;
}

// What the card shows for the tip on this device: its button, or instead a
// line. A browser that blocked notifications gets how to allow them, never
// the button (it would only ask again, and the browser says no at once).
export function tipCardParts(tip: Tip, device: TipDevice): { button: boolean; notice: string | null } {
  if (tip.action.kind === "push" && device.push === "denied") return { button: false, notice: PUSH_NOTICES.denied ?? null };
  return { button: true, notice: null };
}

export function tipById(id: string, tips: readonly Tip[] = TIPS): Tip | undefined {
  return tips.find((t) => t.id === id);
}

// The Kezdőlap's tips (#262, D160): one list, one at a time, the push tip's
// conditions and "Most nem" (14 days, then for good).
import { describe, expect, it } from "vitest";

import type { PushDeviceState } from "./push/device";
import { isDismissed, offeredTips, tipById, tipCardParts, tipToShow, TIPS, type Tip } from "./tips";

const NOW = new Date("2026-11-20T10:00:00Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const ACCOUNT = { pushChannelOn: true, pushConfigured: true };
const push = tipById("push")!;
const device = (state: PushDeviceState) => ({ push: state });

describe("the push tip", () => {
  it("has the issue's copy", () => {
    expect(push).toMatchObject({
      title: "Kapj értesítést a telefonodra",
      text: "Szól, ha időpontot ajánlanak vagy eredményt kell visszaigazolnod.",
      button: "Bekapcsolom",
      action: { kind: "push" },
    });
    expect(TIPS[0]).toBe(push);
  });

  it("is offered while the push channel is on and the site can push", () => {
    expect(push.offered(ACCOUNT)).toBe(true);
    expect(push.offered({ ...ACCOUNT, pushChannelOn: false })).toBe(false);
    expect(push.offered({ ...ACCOUNT, pushConfigured: false })).toBe(false);
  });

  it("applies on a device that can push and has no subscription, or blocked it (then it says how to allow)", () => {
    expect(push.applies(device("off"))).toBe(true);
    expect(push.applies(device("denied"))).toBe(true);
    // Subscribed here: done, it goes at once.
    expect(push.applies(device("on"))).toBe(false);
    // No push in this browser, or still checking: no tip.
    expect(push.applies(device("unsupported"))).toBe(false);
    expect(push.applies(device("ios-browser"))).toBe(false);
    expect(push.applies(device("checking"))).toBe(false);
  });
});

describe("the card's parts", () => {
  it("a blocked browser gets how to allow notifications, not the button (no new prompt)", () => {
    expect(tipCardParts(push, device("denied"))).toEqual({ button: false, notice: expect.stringContaining("beállításaiban engedélyezheted") });
  });

  it("a browser that can still ask gets the button and no line", () => {
    expect(tipCardParts(push, device("off"))).toEqual({ button: true, notice: null });
  });

  it("a link tip always has its button", () => {
    const link: Tip = { ...push, id: "link", action: { kind: "link", to: "/rules" } };
    expect(tipCardParts(link, device("denied"))).toEqual({ button: true, notice: null });
  });
});

describe("Most nem", () => {
  it("hides a tip for 14 days; the second time for good", () => {
    expect(isDismissed(undefined, NOW)).toBe(false);
    expect(isDismissed({ count: 1, dismissedAt: ago(0) }, NOW)).toBe(true);
    expect(isDismissed({ count: 1, dismissedAt: ago(13.9) }, NOW)).toBe(true);
    expect(isDismissed({ count: 1, dismissedAt: ago(14) }, NOW)).toBe(false);
    expect(isDismissed({ count: 2, dismissedAt: ago(400) }, NOW)).toBe(true);
  });

  it("a dismissed tip is not offered", () => {
    expect(offeredTips(TIPS, ACCOUNT, new Map(), NOW)).toEqual([push]);
    expect(offeredTips(TIPS, ACCOUNT, new Map([["push", { count: 1, dismissedAt: ago(1) }]]), NOW)).toEqual([]);
    expect(offeredTips(TIPS, ACCOUNT, new Map([["push", { count: 1, dismissedAt: ago(15) }]]), NOW)).toEqual([push]);
  });
});

describe("one list, one at a time", () => {
  // A second tip is one more entry: shown when the first doesn't apply or
  // is dismissed.
  const stub: Tip = {
    id: "stub",
    title: "Stub",
    text: "Csak egy próba.",
    button: "Megnézem",
    action: { kind: "link", to: "/rules" },
    offered: () => true,
    applies: () => true,
  };
  const list = [...TIPS, stub];

  it("shows the first that applies and isn't dismissed", () => {
    const offered = offeredTips(list, ACCOUNT, new Map(), NOW);
    expect(tipToShow(offered, device("off"))).toBe(push);
    // Push already on here: the next one.
    expect(tipToShow(offered, device("on"))).toBe(stub);
    // Push dismissed: the next one, on every device.
    const later = offeredTips(list, ACCOUNT, new Map([["push", { count: 1, dismissedAt: ago(1) }]]), NOW);
    expect(tipToShow(later, device("off"))).toBe(stub);
    expect(tipById("stub", list)).toBe(stub);
  });

  it("nothing to show: no tip", () => {
    expect(tipToShow(offeredTips(TIPS, ACCOUNT, new Map(), NOW), device("on"))).toBeNull();
    expect(tipToShow([], device("off"))).toBeNull();
  });

  it("every tip has the card's parts and a unique id", () => {
    expect(new Set(TIPS.map((t) => t.id)).size).toBe(TIPS.length);
    for (const t of TIPS) for (const s of [t.title, t.text, t.button]) expect(s.length).toBeGreaterThan(0);
  });
});

import { describe, expect, it } from "vitest";

import {
  absenceCountText,
  answerRefusal,
  changeCountText,
  currentStatus,
  decideRefusal,
  finalText,
  isLive,
  lapsesAt,
  openText,
  startRefusal,
  startsAt,
  startsText,
  undoRefusal,
  waitingText,
  withdrawRefusal,
} from "./partner-changes";

describe("the organizer's approval (#416)", () => {
  const SENT_AT = new Date("2026-11-20T10:00:00Z");

  it("only an accepted change waits for a decision; a reason is at most 300 characters", () => {
    expect(decideRefusal({ status: "accepted" })).toBeNull();
    expect(decideRefusal({ status: "accepted" }, "x".repeat(300))).toBeNull();
    expect(decideRefusal({ status: "accepted" }, "x".repeat(301))).toBe("reason");
    for (const status of ["open", "final", "rejected", "started"] as const) expect(decideRefusal({ status })).toBe("not_waiting");
  });

  it("a waiting change holds the pair and never lapses", () => {
    expect(isLive("accepted")).toBe(true);
    expect(isLive("rejected")).toBe(false);
    expect(currentStatus({ status: "accepted", createdAt: SENT_AT }, new Date("2026-12-30T10:00:00Z"))).toBe("accepted");
  });

  it("tells each player it waits, and Párok how often they changed partner", () => {
    const c = { starter: "Anna", leaving: "Béla", partner: "Cili" };
    expect(waitingText("staying", c)).toBe("Jóváhagyásra vár: Cili elfogadta, a szervező dönt róla. Addig Béla játszik veled.");
    expect(waitingText("partner", c)).toBe("Jóváhagyásra vár: elfogadtad Anna kérését, a szervező dönt róla.");
    expect(waitingText("leaving", c)).toContain("Jóváhagyásra vár");
    expect(changeCountText("Anna", 0)).toBe("Anna: még nem cserélt partnert ebben a szezonban.");
    expect(changeCountText("Anna", 2)).toBe("Anna: 2 állandó partnercsere ebben a szezonban.");
    expect(absenceCountText(0)).toBeNull();
    expect(absenceCountText(3)).toBe("Helyettessel: 3 meccs ebben a szezonban");
  });
});

const SENT = new Date("2026-11-20T10:00:00Z");
const day = (n: number) => new Date(SENT.getTime() + n * 86_400_000);

describe("lapse (#402 req 2: an unanswered change lapses after 7 days)", () => {
  it("is open until 7 days after it was sent, lapsed from then", () => {
    expect(lapsesAt(SENT)).toEqual(day(7));
    expect(currentStatus({ status: "open", createdAt: SENT }, new Date(day(7).getTime() - 1))).toBe("open");
    expect(currentStatus({ status: "open", createdAt: SENT }, day(7))).toBe("lapsed");
  });

  it("never touches an answered change", () => {
    expect(currentStatus({ status: "final", createdAt: SENT }, day(30))).toBe("final");
    expect(currentStatus({ status: "declined", createdAt: SENT }, day(30))).toBe("declined");
  });

  it("only an open or final change holds the pair", () => {
    expect(["open", "final"].every((s) => isLive(s as never))).toBe(true);
    expect(["withdrawn", "declined", "lapsed", "undone", "started"].some((s) => isLive(s as never))).toBe(false);
  });
});

describe("startRefusal (#402 req 1, 2)", () => {
  const ok = { pair: { players: ["a", "b"] }, seasonOpen: true, live: false, partnerId: "c", partnerFree: true };

  it("lets either player of an active, entered pair name a free player", () => {
    expect(startRefusal(ok)).toBeNull();
  });

  it("refuses without a pair whose entry continues", () => {
    expect(startRefusal({ ...ok, pair: null })).toBe("no_pair");
  });

  it("refuses after the season's last round deadline", () => {
    expect(startRefusal({ ...ok, seasonOpen: false })).toBe("season_over");
  });

  it("refuses a second change for the same pair while one is open or final", () => {
    expect(startRefusal({ ...ok, live: true })).toBe("already");
  });

  it("refuses a new partner who already has an active pair, or one of the pair itself", () => {
    expect(startRefusal({ ...ok, partnerFree: false })).toBe("partner");
    expect(startRefusal({ ...ok, partnerId: "b" })).toBe("partner");
  });
});

describe("answerRefusal, withdrawRefusal, undoRefusal", () => {
  const change = { status: "open" as const, partnerId: "c", startedBy: "a" };
  const free = { partnerFree: true, pairActive: true, seasonOpen: true };

  it("only the new partner answers, while it is open", () => {
    expect(answerRefusal(change, "c", free)).toBeNull();
    expect(answerRefusal(change, "c", null)).toBeNull();
    expect(answerRefusal(change, "a", free)).toBe("not_yours");
    expect(answerRefusal({ ...change, status: "lapsed" }, "c", free)).toBe("not_open");
  });

  it("an accept needs the new partner still free, the old pair still active and the season still running", () => {
    expect(answerRefusal(change, "c", { ...free, partnerFree: false })).toBe("partner");
    expect(answerRefusal(change, "c", { ...free, pairActive: false })).toBe("not_open");
    expect(answerRefusal(change, "c", { ...free, seasonOpen: false })).toBe("season_over");
    // A decline needs none of that.
    expect(answerRefusal(change, "c", null)).toBeNull();
  });

  it("only the one who sent it withdraws, while it is open", () => {
    expect(withdrawRefusal(change, "a")).toBeNull();
    expect(withdrawRefusal(change, "b")).toBe("not_yours");
    expect(withdrawRefusal({ ...change, status: "final" }, "a")).toBe("not_open");
  });

  it("the organizer undoes only a final change, not once the new pair started", () => {
    expect(undoRefusal({ status: "final" })).toBeNull();
    expect(undoRefusal({ status: "started" })).toBe("not_final");
    expect(undoRefusal({ status: "open" })).toBe("not_final");
  });
});

describe("startsAt (#402 req 6)", () => {
  const phases = [1, 2, 3, 4];

  it("a pair waiting for its first round: at once", () => {
    expect(startsAt({ phases, withGroups: [], played: false })).toEqual({ kind: "now" });
    expect(startsAt({ phases, withGroups: [1], played: false })).toEqual({ kind: "now" });
  });

  it("in a running round before the round switch draft: at the next switch", () => {
    expect(startsAt({ phases, withGroups: [1], played: true })).toEqual({ kind: "switch", phase: 2 });
  });

  it("after the round switch draft was made (or published): at the following switch", () => {
    expect(startsAt({ phases, withGroups: [1, 2], played: true })).toEqual({ kind: "switch", phase: 3 });
  });

  it("in the season's last round, or after its draft: at the season switch", () => {
    expect(startsAt({ phases, withGroups: [1, 2, 3, 4], played: true })).toEqual({ kind: "season" });
    expect(startsAt({ phases: [1, 2], withGroups: [1, 2], played: true })).toEqual({ kind: "season" });
  });
});

describe("texts", () => {
  it("names the round or the next season", () => {
    expect(startsText(2)).toBe("a 2. körtől");
    expect(startsText(5)).toBe("az 5. körtől");
    expect(startsText(null)).toBe("a következő szezontól");
  });

  it("tells each player of an open change their part", () => {
    const c = { starter: "Anna", leaving: "Béla", partner: "Cili", lapsesAt: new Date("2026-11-27T10:00:00Z") };
    expect(openText("staying", c)).toBe("Elküldted Cili részére. november 27-ig válaszolhat.");
    expect(openText("partner", c)).toContain("Anna állandó partnernek hív Béla helyett.");
    expect(openText("partner", c)).toContain("November 27-ig válaszolhatsz.");
    expect(openText("leaving", c)).toContain("Cili játszana helyetted");
  });

  it("tells each player of a final change from when", () => {
    const c = { staying: "Anna", leaving: "Béla", partner: "Cili", phase: 2 };
    expect(finalText("staying", c)).toBe("A 2. körtől Cili a párod. Addig Béla helyett játszik a hátralévő meccseiteken.");
    expect(finalText("leaving", c)).toBe("Cili játszik helyetted Anna mellett. A 2. körtől nincs párod ebben a ligában.");
    expect(finalText("partner", { ...c, phase: null })).toContain("A következő szezontól Anna párja vagy.");
  });
});

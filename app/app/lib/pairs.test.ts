import { describe, expect, it } from "vitest";

import {
  canDissolve,
  checkNewPair,
  checkPairLink,
  NEW_PAIR_REFUSALS,
  PAIR_LINK_REFUSALS,
  PAIR_SECTION_PATH,
  pairPageDescription,
  pairSectionUrl,
  SOURCE_LABELS,
} from "./pairs";

describe("checkNewPair (#97)", () => {
  const ok = { a: "a", b: "b", registered: true, paired: false };

  it("allows two registered players without a pair in the league", () => {
    expect(checkNewPair(ok)).toBeNull();
  });

  it("refuses the same player twice, or a missing one", () => {
    expect(checkNewPair({ ...ok, b: "a" })).toBe("same");
    expect(checkNewPair({ ...ok, b: "" })).toBe("same");
  });

  it("refuses a player who hasn't registered", () => {
    expect(checkNewPair({ ...ok, registered: false })).toBe("unknown");
  });

  it("refuses when either is already in an active pair in the league", () => {
    expect(checkNewPair({ ...ok, paired: true })).toBe("paired");
  });

  it("has a Hungarian message for every refusal", () => {
    for (const text of Object.values(NEW_PAIR_REFUSALS)) expect(text).toMatch(/[áéíóöőúüű]/);
  });
});

describe("canDissolve (#97)", () => {
  it("allows an active pair in no running group", () => {
    expect(canDissolve({ status: "active" }, false)).toBe(true);
  });

  it("refuses while the pair is in a published group before the round's deadline", () => {
    expect(canDissolve({ status: "active" }, true)).toBe(false);
  });

  it("refuses a pair already dissolved", () => {
    expect(canDissolve({ status: "dissolved" }, false)).toBe(false);
  });
});

describe("SOURCE_LABELS", () => {
  it("names every source", () => {
    expect(SOURCE_LABELS).toEqual({ signup: "jelentkezésből", manual: "kézzel", link: "linkkel", search: "Párkeresők" });
  });
});

describe("checkPairLink (2026-10-31)", () => {
  const ok = { ownerId: "a", userId: "b", userPaired: false, ownerPaired: false };

  it("lets another player without a pair accept", () => {
    expect(checkPairLink(ok)).toBeNull();
  });

  it("refuses the owner's own link, even while both flags are set", () => {
    expect(checkPairLink({ ...ok, userId: "a" })).toBe("own");
    expect(checkPairLink({ ...ok, userId: "a", userPaired: true, ownerPaired: true })).toBe("own");
  });

  it("refuses a player already in a pair before looking at the owner", () => {
    expect(checkPairLink({ ...ok, userPaired: true })).toBe("you_paired");
    expect(checkPairLink({ ...ok, userPaired: true, ownerPaired: true })).toBe("you_paired");
  });

  it("refuses when the owner has a pair by now", () => {
    expect(checkPairLink({ ...ok, ownerPaired: true })).toBe("owner_paired");
  });

  it("has a Hungarian message for every refusal", () => {
    expect(Object.keys(PAIR_LINK_REFUSALS).sort()).toEqual(["own", "owner_paired", "you_paired"]);
  });
});

describe("pairPageDescription (#124)", () => {
  it("names the address and the change only for a player with a pair", () => {
    expect(pairPageDescription(true, "a@b.hu")).toBe("Egy ligában egy párod lehet. Ha változna, írj nekünk: a@b.hu");
  });
  it("gives neither the address nor the change line without a pair", () => {
    const text = pairPageDescription(false, "a@b.hu");
    expect(text).toBe("Egy ligában egy párod lehet.");
    expect(text).not.toContain("a@b.hu");
    expect(text).not.toContain("változna");
  });
});

describe("the Párod section of Profil (D141, #346)", () => {
  it("is Profil's Játékosprofil tab at the section", () => {
    expect(PAIR_SECTION_PATH).toBe("/profile#parod");
    expect(pairSectionUrl()).toBe("/profile#parod");
    expect(pairSectionUrl("?")).toBe("/profile#parod");
  });
  it("keeps the old address's query", () => {
    expect(pairSectionUrl("?joined=1")).toBe("/profile?joined=1#parod");
    expect(pairSectionUrl("?joined=1&league=gyor")).toBe("/profile?joined=1&league=gyor#parod");
  });
});

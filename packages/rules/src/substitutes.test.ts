import { describe, expect, it } from "vitest";

import { matchEloChanges, replayElo, type EloState } from "./elo";
import {
  approvalRefusal,
  isLiveSubstitute,
  playedBy,
  rejectionRefusal,
  requestRefusal,
  revocationRefusal,
  substituteClosesAt,
  substituteOpen,
  withdrawalRefusal,
  type SubstituteCheck,
} from "./substitutes";

const deadline = new Date("2026-11-29T22:59:00Z");
const slot = new Date("2026-11-18T18:00:00Z");

describe("when a substitute can be asked for (spec 4, D109)", () => {
  it("closes at the agreed start, or at the deadline without one", () => {
    expect(substituteClosesAt({ scheduledAt: slot, deadline })).toEqual(slot);
    expect(substituteClosesAt({ scheduledAt: null, deadline })).toEqual(deadline);
  });

  it("is open only before the start, without a result, on a match that counts", () => {
    const before = new Date(slot.getTime() - 1000);
    expect(substituteOpen({ closesAt: slot, hasResult: false, voided: false }, before)).toBe(true);
    expect(substituteOpen({ closesAt: slot, hasResult: false, voided: false }, slot)).toBe(false);
    expect(substituteOpen({ closesAt: slot, hasResult: true, voided: false }, before)).toBe(false);
    expect(substituteOpen({ closesAt: slot, hasResult: false, voided: true }, before)).toBe(false);
  });

  it("treats waiting and approved requests as live", () => {
    expect(isLiveSubstitute("requested")).toBe(true);
    expect(isLiveSubstitute("approved")).toBe(true);
    for (const s of ["rejected", "withdrawn", "revoked"] as const) expect(isLiveSubstitute(s)).toBe(false);
  });
});

const base: SubstituteCheck & { pair: readonly string[]; absentId: string } = {
  open: true,
  matchPlayers: ["a1", "a2", "b1", "b2"],
  groupPlayers: new Set(["a1", "a2", "b1", "b2", "c1", "c2", "d1", "d2"]),
  registered: true,
  substituteId: "s",
  live: [],
  pair: ["a1", "a2"],
  absentId: "a2",
};

describe("requestRefusal (spec 4)", () => {
  it("lets a player of the pair name a registered outsider for an absent partner", () => {
    expect(requestRefusal(base)).toBeNull();
  });

  it("lets the player name a substitute for themself", () => {
    expect(requestRefusal({ ...base, absentId: "a1" })).toBeNull();
  });

  it("refuses once the match started or has a result", () => {
    expect(requestRefusal({ ...base, open: false })).toBe("closed");
  });

  it("refuses an absent player who is not of the asking pair", () => {
    expect(requestRefusal({ ...base, absentId: "b1" })).toBe("not_absent");
  });

  it("allows one live substitute per absent player", () => {
    expect(requestRefusal({ ...base, live: [{ absentId: "a2", substituteId: "x" }] })).toBe("already");
    // The other absent player of the pair may still get one.
    expect(requestRefusal({ ...base, absentId: "a1", live: [{ absentId: "a2", substituteId: "x" }] })).toBeNull();
  });

  it("refuses one of the four players", () => {
    expect(requestRefusal({ ...base, substituteId: "b1" })).toBe("match_player");
    expect(requestRefusal({ ...base, substituteId: "a1" })).toBe("match_player");
  });

  it("refuses a player of another pair of the same group", () => {
    expect(requestRefusal({ ...base, substituteId: "c2" })).toBe("group_player");
  });

  it("allows a player of a pair withdrawn from the group (not in groupPlayers)", () => {
    expect(requestRefusal({ ...base, groupPlayers: new Set(["a1", "a2", "b1", "b2"]), substituteId: "c2" })).toBeNull();
  });

  it("refuses an account that is not a registered player of the league", () => {
    expect(requestRefusal({ ...base, registered: false })).toBe("not_registered");
  });

  it("refuses a substitute already named on this match, also by the other pair", () => {
    expect(requestRefusal({ ...base, live: [{ absentId: "b2", substituteId: "s" }] })).toBe("taken");
  });
});

describe("approvalRefusal (spec 4: the organizer approves before the match)", () => {
  const check = { ...base, status: "requested" as const };
  it("approves a waiting, still valid request before the start", () => {
    expect(approvalRefusal(check)).toBeNull();
  });
  it("refuses after the start", () => {
    expect(approvalRefusal({ ...check, open: false })).toBe("closed");
  });
  it("refuses a request that isn't waiting", () => {
    for (const status of ["approved", "rejected", "withdrawn", "revoked"] as const) expect(approvalRefusal({ ...check, status })).toBe("not_requested");
  });
  it("checks the substitute again (e.g. joined the group meanwhile, or deleted)", () => {
    expect(approvalRefusal({ ...check, substituteId: "d1" })).toBe("group_player");
    expect(approvalRefusal({ ...check, registered: false })).toBe("not_registered");
    expect(approvalRefusal({ ...check, live: [{ absentId: "b1", substituteId: "s" }] })).toBe("taken");
  });
});

describe("rejection, revocation, withdrawal", () => {
  it("rejects only a waiting request", () => {
    expect(rejectionRefusal("requested")).toBeNull();
    expect(rejectionRefusal("approved")).toBe("not_requested");
  });
  it("revokes only an approval, only before the start", () => {
    expect(revocationRefusal("approved", true)).toBeNull();
    expect(revocationRefusal("approved", false)).toBe("closed");
    expect(revocationRefusal("requested", true)).toBe("not_approved");
  });
  it("lets only the asking player withdraw, only while it waits", () => {
    expect(withdrawalRefusal({ status: "requested", requestedBy: "a1" }, "a1")).toBeNull();
    expect(withdrawalRefusal({ status: "requested", requestedBy: "a1" }, "a2")).toBe("not_requester");
    expect(withdrawalRefusal({ status: "approved", requestedBy: "a1" }, "a1")).toBe("not_requested");
  });
});

describe("Elo from who actually played (spec 11)", () => {
  it("puts the approved substitute in the absent player's place", () => {
    expect(playedBy(["a1", "a2"], new Map([["a2", "s"]]))).toEqual(["a1", "s"]);
    expect(playedBy(["a1", "a2"], new Map([["a1", "s"], ["a2", "t"]]))).toEqual(["s", "t"]);
    expect(playedBy(["a1", "a2"], new Map())).toEqual(["a1", "a2"]);
  });

  it("changes the substitute's rating and leaves the absent player's alone", () => {
    const start: Record<string, number> = { a1: 1200, a2: 1200, b1: 1200, b2: 1200, s: 1000 };
    const { players, changes } = replayElo((id) => start[id]!, [
      { id: 1, a: playedBy(["a1", "a2"], new Map([["a2", "s"]])), b: ["b1", "b2"], winner: "a" },
    ]);
    expect(players.has("a2")).toBe(false);
    expect(changes.some((c) => c.playerId === "a2")).toBe(false);
    expect(players.get("s")!.rating).toBeGreaterThan(1000);
    // The match counts as rated for the substitute (spec 10 placement, K).
    expect(players.get("s")!.matches).toBe(1);
  });

  it("rates the side from the substitute's own Elo", () => {
    const state = (r: Record<string, number>) => (id: string): EloState => ({ rating: r[id]!, matches: 0 });
    const withSub = matchEloChanges({ id: 1, a: ["a1", "s"], b: ["b1", "b2"], winner: "a" }, state({ a1: 1200, s: 1000, b1: 1200, b2: 1200 }));
    const without = matchEloChanges({ id: 1, a: ["a1", "a2"], b: ["b1", "b2"], winner: "a" }, state({ a1: 1200, a2: 1200, b1: 1200, b2: 1200 }));
    // An underdog side wins more.
    expect(withSub[0]!.delta).toBeGreaterThan(without[0]!.delta);
  });
});

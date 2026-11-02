import { describe, expect, it } from "vitest";

import type { PlayerPair, PlayerStatus } from "./player-status";
import {
  filterByStage,
  FUNNEL,
  inviteChip,
  invitedEmails,
  isStage,
  parseStage,
  progressContext,
  personStage,
  signupEmails,
  signupStages,
  stageCounts,
  STAGES,
  type ProgressContext,
} from "./signup-progress";

const registered = (pairs: PlayerPair[] = []): PlayerStatus => ({ registered: true, level: "kezdo", phone: true, pairs });
const pair = (over: Partial<PlayerPair> = {}): PlayerPair => ({
  leagueId: 1,
  league: "Padelpárbaj Győr",
  city: "gyor",
  partner: "Béla",
  entry: null,
  season: "Tél",
  ...over,
});
const stage = (status: PlayerStatus | undefined, over: { invited?: boolean; withdrawn?: boolean; leagueIds?: number[] } = {}) =>
  personStage({ status, invited: false, withdrawn: false, leagueIds: [1], ...over });

describe("a person's stage on the way to an entry", () => {
  it("without an account: invited or not, no league, withdrawn", () => {
    expect(stage(undefined)).toBe("not_invited");
    expect(stage(undefined, { invited: true })).toBe("no_account");
    expect(stage(undefined, { leagueIds: [] })).toBe("no_league");
    expect(stage(undefined, { withdrawn: true, invited: true })).toBe("withdrawn");
  });

  it("with an account: unfinished, no pair, not entered, entered", () => {
    expect(stage({ registered: false, level: null, phone: false, pairs: [] })).toBe("unfinished");
    expect(stage(registered())).toBe("no_pair");
    expect(stage(registered([pair()]))).toBe("not_entered");
    expect(stage(registered([pair({ entry: { season: "Tél", status: "pending" } })]))).toBe("entered");
    expect(stage(registered([pair({ entry: { season: "Tél", status: "approved" } })]))).toBe("entered");
  });

  it("a rejected or withdrawn entry is not an entry", () => {
    expect(stage(registered([pair({ entry: { season: "Tél", status: "rejected" } })]))).toBe("not_entered");
    expect(stage(registered([pair({ entry: { season: "Tél", status: "withdrawn" } })]))).toBe("not_entered");
  });

  it("a pair while the league has no season to enter", () => {
    expect(stage(registered([pair({ season: null })]))).toBe("paired");
  });

  it("counts only the leagues of the signup's city", () => {
    expect(stage(registered([pair({ leagueId: 2 })]))).toBe("no_pair");
    expect(stage(registered([pair()]), { leagueIds: [] })).toBe("no_league");
  });

  it("an account counts over a withdrawn signup", () => {
    expect(stage(registered(), { withdrawn: true })).toBe("no_pair");
  });
});

describe("stages of the interest list", () => {
  const base = { city: "gyor", status: "new" as const, invitedAt: null, invited2At: null, email2: null };
  const rows = [
    { ...base, id: 3, mode: "pair" as const, email1: "Anna@x.hu", email2: "bela@x.hu", invitedAt: new Date() },
    { ...base, id: 2, mode: "solo" as const, email1: "cecil@x.hu" },
    // Anna again, older: counted once.
    { ...base, id: 1, mode: "pair" as const, email1: "anna@x.hu", email2: "dora@x.hu", invited2At: new Date() },
  ];
  const ctx: ProgressContext = {
    invited: invitedEmails(rows),
    status: (email) => (email === "anna@x.hu" ? registered() : undefined),
    leagueIds: (city) => (city === "gyor" ? [1] : []),
  };

  it("knows who got the invite, through any signup", () => {
    expect([...invitedEmails(rows)].sort()).toEqual(["anna@x.hu", "dora@x.hu"]);
  });

  it("lists the people with an email, the partner only on a pair signup", () => {
    expect(signupEmails(rows[0])).toEqual(["anna@x.hu", "bela@x.hu"]);
    expect(signupEmails({ mode: "solo", email1: "c@x.hu", email2: "z@x.hu" })).toEqual(["c@x.hu"]);
    expect(signupEmails({ mode: "pair", email1: "c@x.hu", email2: null })).toEqual(["c@x.hu"]);
  });

  it("gives each signup its people's stages", () => {
    expect(signupStages(rows[0], ctx)).toEqual(["no_pair", "not_invited"]);
    expect(signupStages(rows[2], ctx)).toEqual(["no_pair", "no_account"]);
  });

  it("counts every address once", () => {
    expect(stageCounts(rows, ctx)).toEqual({
      not_invited: 2,
      no_account: 1,
      unfinished: 0,
      no_pair: 1,
      not_entered: 0,
      entered: 0,
      paired: 0,
      no_league: 0,
      withdrawn: 0,
    });
  });

  it("labels every stage, the funnel in order", () => {
    expect(FUNNEL.every(isStage)).toBe(true);
    expect(isStage("nope")).toBe(false);
    expect(Object.keys(STAGES).slice(0, FUNNEL.length)).toEqual(FUNNEL);
    expect(inviteChip("not_invited")).toEqual({ text: "Nem kapott meghívót", tone: "todo" });
    expect(inviteChip("no_account")).toEqual({ text: "Meghívót kapott", tone: "muted" });
    expect(inviteChip("no_pair")).toBeNull();
  });
});

describe("the Hol tart filter", () => {
  const base = { city: "gyor", status: "new" as const, invitedAt: null, invited2At: null };
  const rows = [
    { ...base, id: 1, mode: "pair" as const, email1: "a@x.hu", email2: "b@x.hu", invitedAt: new Date() },
    { ...base, id: 2, mode: "solo" as const, email1: "c@x.hu", email2: null },
    { ...base, id: 3, mode: "solo" as const, email1: "d@x.hu", email2: null, city: "other" },
  ];
  const status = new Map<string, PlayerStatus>([["b@x.hu", registered()]]);
  const ctx = progressContext(rows, status, [{ id: 1, city: "gyor" }]);

  it("keeps the signups with someone at the stage", () => {
    expect(filterByStage(rows, "no_pair", ctx).map((r) => r.id)).toEqual([1]);
    expect(filterByStage(rows, "not_invited", ctx).map((r) => r.id)).toEqual([2]);
    expect(filterByStage(rows, "no_account", ctx).map((r) => r.id)).toEqual([1]);
    expect(filterByStage(rows, "no_league", ctx).map((r) => r.id)).toEqual([3]);
    expect(filterByStage(rows, null, ctx)).toHaveLength(3);
  });

  it("reads only a known stage from the query string", () => {
    expect(parseStage(new URLSearchParams("stage=no_pair"))).toBe("no_pair");
    expect(parseStage(new URLSearchParams("stage=hack"))).toBeNull();
    expect(parseStage(new URLSearchParams(""))).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import {
  confirmText,
  confirmTitle,
  formatFromDate,
  formatUntilTime,
  leftText,
  optedOutText,
  optOutEntryText,
  optOutMessage,
  optOutRefusal,
  optOutState,
  optOutView,
  optOutWindow,
  stayInText,
} from "./opt-out";

// Győr's season: round 1 from nov. 9 to dec. 6 (extended), round 2 from
// dec. 7, round 3, round 4 the last. Budapest is UTC+1.
const PHASES = [
  { number: 1, startsAt: new Date("2026-11-08T23:00:00Z"), deadline: new Date("2026-12-06T22:59:00Z") },
  { number: 2, startsAt: new Date("2026-12-06T23:00:00Z"), deadline: new Date("2026-12-27T22:59:00Z") },
  { number: 3, startsAt: new Date("2026-12-27T23:00:00Z"), deadline: new Date("2027-01-17T22:59:00Z") },
  { number: 4, startsAt: new Date("2027-01-17T23:00:00Z"), deadline: new Date("2027-02-07T22:59:00Z") },
];
const DURING = new Date("2026-11-25T10:00:00Z");
const LAST_MINUTE = new Date("2026-12-06T22:59:00Z");
const AFTER = new Date("2026-12-06T22:59:01Z");
const BEFORE_START = new Date("2026-11-08T10:00:00Z");
const IN_LAST = new Date("2027-01-25T10:00:00Z");

describe("dates in the copy (#395)", () => {
  it("writes the next round's start and the deadline as the issue has them", () => {
    expect(formatFromDate(PHASES[1]!.startsAt)).toBe("dec. 7-től");
    expect(formatUntilTime(PHASES[0]!.deadline)).toBe("dec. 6., 23:59-ig");
  });

  it("picks -tól or -től by the day read as a number", () => {
    const day = (d: number) => formatFromDate(new Date(Date.UTC(2026, 0, d, 12)));
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(day)).toEqual([
      "jan. 1-től",
      "jan. 2-től",
      "jan. 3-tól",
      "jan. 4-től",
      "jan. 5-től",
      "jan. 6-tól",
      "jan. 7-től",
      "jan. 8-tól",
      "jan. 9-től",
      "jan. 10-től",
    ]);
    expect([13, 20, 23, 30, 31].map(day)).toEqual(["jan. 13-tól", "jan. 20-tól", "jan. 23-tól", "jan. 30-tól", "jan. 31-től"]);
  });
});

describe("optOutWindow (#395: from the round's start to its deadline, not in the last round)", () => {
  it("is the running round the pair plays, with the next round's start", () => {
    expect(optOutWindow(PHASES, [1], DURING)).toEqual({
      round: 1,
      deadline: PHASES[0]!.deadline,
      nextRound: 2,
      nextStart: PHASES[1]!.startsAt,
    });
  });

  it("is open until the deadline minute, closed after it and before the round starts", () => {
    expect(optOutWindow(PHASES, [1], LAST_MINUTE)?.round).toBe(1);
    expect(optOutWindow(PHASES, [1], AFTER)).toBeNull();
    expect(optOutWindow(PHASES, [1], BEFORE_START)).toBeNull();
  });

  it("is closed for a pair that doesn't play the running round, and in the season's last round", () => {
    expect(optOutWindow(PHASES, [], DURING)).toBeNull();
    expect(optOutWindow(PHASES, [2], DURING)).toBeNull();
    expect(optOutWindow(PHASES, [1, 2, 3, 4], IN_LAST)).toBeNull();
  });
});

describe("optOutState: what the Ligáim card shows (#395)", () => {
  const window = optOutWindow(PHASES, [1], DURING);
  const none = { optOutPhase: null, optedOutBy: null };

  it("says default in, with the deadline to opt out", () => {
    const state = optOutState(window, none, "me", DURING, PHASES);
    expect(state).toEqual({ kind: "in", window });
    expect(stayInText(window!)).toBe("Benne vagytok a 2. körben (dec. 7-től). Ha nem folytatnád, jelezd dec. 6., 23:59-ig.");
  });

  it("shows the opt-out to both players; only the one who did can take it back", () => {
    const out = { optOutPhase: 1, optedOutBy: "me" };
    expect(optOutState(window, out, "me", DURING, PHASES)).toEqual({ kind: "out", window, mine: true });
    expect(optOutState(window, out, "partner", DURING, PHASES)).toEqual({ kind: "out", window, mine: false });
    expect(optedOutText(window!, true)).toBe("Jelezted, hogy nem folytatod: az 1. kör után kiléptek a szezonból. Meggondolhatod dec. 6., 23:59-ig.");
    expect(optedOutText(window!, false)).toBe("A párod jelezte, hogy nem folytatja: az 1. kör után kiléptek a szezonból.");
  });

  it("after the deadline: nothing for a pair that plays on, that it doesn't play on for one that opted out", () => {
    expect(optOutState(null, none, "me", AFTER, PHASES)).toBeNull();
    expect(optOutState(null, { optOutPhase: 1, optedOutBy: "partner" }, "me", AFTER, PHASES)).toEqual({ kind: "left", round: 1 });
    expect(leftText(1)).toBe("Az 1. kör után nem folytatjátok a szezont.");
  });

  it("nothing in the season's last round", () => {
    expect(optOutState(optOutWindow(PHASES, [4], IN_LAST), none, "me", IN_LAST, PHASES)).toBeNull();
  });
});

describe("optOutView: the card's section (#395)", () => {
  const window = optOutWindow(PHASES, [1], DURING)!;

  it("offers 'Nem folytatom' with a confirmation while in, 'Mégis folytatom' only to the one who opted out", () => {
    expect(optOutView({ kind: "in", window })).toEqual({
      text: stayInText(window),
      action: "opt_out",
      confirm: { title: confirmTitle(window), text: confirmText(window) },
    });
    expect(optOutView({ kind: "out", window, mine: true })).toMatchObject({ action: "undo", confirm: null });
    expect(optOutView({ kind: "out", window, mine: false })).toMatchObject({ action: null });
    expect(optOutView({ kind: "left", round: 1 })).toEqual({ text: leftText(1), action: null, confirm: null });
  });
});

describe("the confirmation (#395 requirement 3)", () => {
  const window = optOutWindow(PHASES, [1], DURING)!;

  it("says the pair leaves after this round, its matches still count, and the partner can go on with someone new", () => {
    expect(confirmTitle(window)).toBe("Nem folytatod a 2. körben?");
    const text = confirmText(window);
    expect(text).toContain("A párotok az 1. kör után kilép a szezonból.");
    expect(text).toContain("Az 1. kör hátralévő meccsei számítanak, ezeket még le kell játszanotok.");
    expect(text).toContain("A párod új partnerrel folytathatja.");
    // No spot is promised to the partner (#402 is the permanent partner change).
    expect(text).not.toMatch(/hely/);
  });
});

describe("optOutRefusal (#395: the server's checks)", () => {
  const input = { phases: PHASES, playing: [1], entry: { optOutPhase: null, optedOutBy: null }, me: "me", now: DURING };

  it("lets either player opt out during the round, once", () => {
    expect(optOutRefusal("opt_out", input)).toBeNull();
    expect(optOutRefusal("opt_out", { ...input, entry: { optOutPhase: 1, optedOutBy: "partner" } })).toBe("already");
  });

  it("refuses after the deadline, opting out and taking it back alike", () => {
    expect(optOutRefusal("opt_out", { ...input, now: AFTER })).toBe("deadline");
    expect(optOutRefusal("undo", { ...input, entry: { optOutPhase: 1, optedOutBy: "me" }, now: AFTER })).toBe("deadline");
  });

  it("refuses in the last round, without a running round, and without an entry", () => {
    expect(optOutRefusal("opt_out", { ...input, playing: [4], now: IN_LAST })).toBe("last_round");
    expect(optOutRefusal("opt_out", { ...input, playing: [] })).toBe("no_round");
    expect(optOutRefusal("opt_out", { ...input, now: BEFORE_START })).toBe("no_round");
    expect(optOutRefusal("opt_out", { ...input, entry: null })).toBe("not_entered");
  });

  it("lets only the player who opted out take it back", () => {
    expect(optOutRefusal("undo", { ...input, entry: { optOutPhase: 1, optedOutBy: "me" } })).toBeNull();
    expect(optOutRefusal("undo", { ...input, entry: { optOutPhase: 1, optedOutBy: "partner" } })).toBe("not_mine");
    expect(optOutRefusal("undo", input)).toBe("not_out");
  });
});

describe("the partner's notice and Párok (#395)", () => {
  it("tells the partner without names, linking to Ligáim", () => {
    const input = { league: "Padelpárbaj Győr", season: "2026 ősz", nextRound: 2 };
    expect(optOutMessage(input, "opt_out")).toEqual({
      title: "A párod nem folytatja",
      body: "A párod nem folytatja a 2. körben, így a párotok kimarad belőle. 2026 ősz, Padelpárbaj Győr.",
      url: "/leagues",
    });
    expect(optOutMessage(input, "undo").body).toBe("A párod mégis folytatja, így a 2. körben is játszotok. 2026 ősz, Padelpárbaj Győr.");
  });

  it("shows the organizer the entry state", () => {
    expect(optOutEntryText({ round: 1, ended: false })).toBe("Kilép a kör végén");
    expect(optOutEntryText({ round: 1, ended: true })).toBe("Kilépett az 1. kör után");
  });
});

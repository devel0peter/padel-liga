// The automatic reminders (#155): who is due, when, and who never is.
import { describe, expect, it } from "vitest";

import {
  countBySituation,
  dueReminders,
  entrySeason,
  isDue,
  nextPhase,
  reminderKey,
  type ReminderAccount,
  type ReminderInput,
  type ReminderPair,
  type ReminderSignup,
} from "./reminders";
import type { Season } from "./seasons";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Monday 2 Nov 2026, 13:00 Budapest.
const NOW = new Date("2026-11-02T12:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

// Registration 29 Oct - 6 Nov 23:59, phase 1 from Mon 9 Nov, 3 weeks each.
function season(over: Partial<Season> = {}): Season {
  const first = new Date("2026-11-08T23:00:00Z").getTime();
  return {
    id: 7,
    leagueId: 1,
    name: "2026/27 tél",
    registrationOpensAt: new Date("2026-10-28T23:00:00Z"),
    registrationClosesAt: new Date("2026-11-06T22:59:00Z"),
    firstPhaseStart: "2026-11-09",
    breaks: [],
    phases: [0, 1, 2, 3].map((i) => ({
      number: i + 1,
      startsAt: new Date(first + i * 21 * DAY),
      deadline: new Date(first + (i + 1) * 21 * DAY - 60_000),
    })),
    ...over,
  };
}

let nextSignup = 1;
function signup(v: Partial<ReminderSignup> & { email1: string }): ReminderSignup {
  return {
    id: nextSignup++,
    mode: "solo",
    city: "gyor",
    status: "new",
    name1: v.email1.split("@")[0]!,
    name2: null,
    email2: null,
    pairedWith: null,
    invitedAt: null,
    invited2At: null,
    ...v,
  };
}

function account(id: string, v: Partial<ReminderAccount> = {}): ReminderAccount {
  return {
    id,
    email: `${id}@x.hu`,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    consentAt: ago(3 * DAY),
    createdAt: ago(3 * DAY),
    admin: false,
    emailOff: false,
    ...v,
  };
}

let nextPair = 1;
function pair(a: string, b: string, v: Partial<ReminderPair> = {}): ReminderPair {
  return { id: nextPair++, leagueId: 1, playerA: a, playerB: b, status: "active", createdAt: ago(3 * DAY), dissolvedAt: null, ...v };
}

function input(v: Partial<ReminderInput> = {}): ReminderInput {
  return {
    now: NOW,
    leagues: [{ id: 1, city: "gyor", name: "Padelpárbaj Győr" }],
    seasons: [season()],
    signups: [],
    accounts: [],
    pairs: [],
    entries: [],
    partnerSearches: [],
    suppressed: new Set(),
    sent: new Set(),
    ...v,
  };
}

const due = (v: Partial<ReminderInput>, leagues = [1]) => dueReminders(input(v), leagues);
const who = (v: Partial<ReminderInput>, leagues = [1]) =>
  due(v, leagues).flatMap((r) => r.recipients.map((p) => `${r.situation} ${p.email}`));

describe("the season the reminders are about", () => {
  it("is the league's season accepting entries: from registration opening until the last phase starts", () => {
    expect(entrySeason([season()], 1, NOW)?.id).toBe(7);
    expect(entrySeason([season()], 1, new Date("2026-10-28T22:00:00Z"))).toBeNull();
    // After the deadline, late entries still work (phase 2 on).
    expect(entrySeason([season()], 1, new Date("2026-11-20T12:00:00Z"))?.id).toBe(7);
    // The last phase has started: no more entries.
    expect(entrySeason([season()], 1, new Date("2027-01-12T12:00:00Z"))).toBeNull();
    expect(entrySeason([season()], 2, NOW)).toBeNull();
  });

  it("gives the next round: the first phase that hasn't started", () => {
    expect(nextPhase(season(), NOW)?.number).toBe(1);
    expect(nextPhase(season(), new Date("2026-11-20T12:00:00Z"))?.number).toBe(2);
  });

  it("sends nothing while no season accepts entries", () => {
    const a = account("anna");
    expect(who({ accounts: [a], seasons: [] })).toEqual([]);
    expect(who({ accounts: [a], seasons: [season({ registrationOpensAt: new Date("2026-11-05T00:00:00Z") })] })).toEqual([]);
  });
});

describe("the waiting time and the deadline rule", () => {
  const s = season();

  it("B waits 24 hours, A, C and D 2 days", () => {
    const early = new Date("2026-10-30T12:00:00Z");
    expect(isDue("B", new Date(early.getTime() - 24 * HOUR), s, early)).toBe(true);
    expect(isDue("B", new Date(early.getTime() - 23 * HOUR), s, early)).toBe(false);
    for (const x of ["A", "C", "D"] as const) {
      expect(isDue(x, new Date(early.getTime() - 2 * DAY), s, early)).toBe(true);
      expect(isDue(x, new Date(early.getTime() - 47 * HOUR), s, early)).toBe(false);
    }
  });

  it("goes out right away when the deadline is under 24 hours away", () => {
    const eve = new Date("2026-11-06T08:00:00Z");
    expect(isDue("C", new Date(eve.getTime() - HOUR), s, eve)).toBe(true);
    // 25 hours before the deadline: still waits.
    const before = new Date("2026-11-05T21:59:00Z");
    expect(isDue("C", new Date(before.getTime() - HOUR), s, before)).toBe(false);
    // After the deadline the waiting time counts again.
    const after = new Date("2026-11-07T08:00:00Z");
    expect(isDue("C", new Date(after.getTime() - HOUR), s, after)).toBe(false);
    expect(isDue("C", new Date(after.getTime() - 2 * DAY), s, after)).toBe(true);
  });

  it("the deadline rule sends a fresh situation at once", () => {
    const eve = new Date("2026-11-06T08:00:00Z");
    const a = account("anna", { consentAt: new Date(eve.getTime() - HOUR), createdAt: new Date(eve.getTime() - HOUR) });
    expect(dueReminders(input({ now: eve, accounts: [a] }), [1]).map((r) => r.situation)).toEqual(["C"]);
  });
});

describe("A: invited, no account", () => {
  it("is reminded 2 days after the invite", () => {
    expect(who({ signups: [signup({ email1: "eva@x.hu", invitedAt: ago(2 * DAY) })] })).toEqual(["A eva@x.hu"]);
    expect(who({ signups: [signup({ email1: "eva@x.hu", invitedAt: ago(DAY) })] })).toEqual([]);
  });

  it("covers the partner of a pair signup by the partner's own invite", () => {
    const s = signup({ mode: "pair", email1: "eva@x.hu", name2: "Feri", email2: "feri@x.hu", invitedAt: ago(DAY), invited2At: ago(3 * DAY) });
    expect(who({ signups: [s] })).toEqual(["A feri@x.hu"]);
  });

  it("names the partner who already registered", () => {
    const s = signup({ mode: "pair", email1: "eva@x.hu", name1: "Éva", name2: "Feri", email2: "feri@x.hu", invitedAt: ago(3 * DAY), invited2At: ago(3 * DAY) });
    const feri = account("feri");
    const [r] = due({ signups: [s], accounts: [feri], pairs: [] });
    expect(r).toMatchObject({ situation: "A", key: "A:eva@x.hu", recipients: [{ email: "eva@x.hu", name: "Éva", partner: "Feri" }] });
    // Not yet registered: no partner line.
    const unfinished = account("feri", { consentAt: null });
    expect(due({ signups: [s], accounts: [unfinished] }).find((x) => x.situation === "A")?.recipients[0].partner).toBeNull();
  });

  it("skips withdrawn signups, unsubscribed or bounced addresses, cities without a league and the uninvited", () => {
    expect(who({ signups: [signup({ email1: "eva@x.hu", invitedAt: ago(3 * DAY), status: "withdrawn" })] })).toEqual([]);
    expect(who({ signups: [signup({ email1: "eva@x.hu", invitedAt: ago(3 * DAY) })], suppressed: new Set(["eva@x.hu"]) })).toEqual([]);
    expect(who({ signups: [signup({ email1: "eva@x.hu", invitedAt: ago(3 * DAY), city: "pecs" })] })).toEqual([]);
    expect(who({ signups: [signup({ email1: "eva@x.hu" })] })).toEqual([]);
  });

  it("is over once there is an account (then B or C applies)", () => {
    const s = signup({ email1: "eva@x.hu", invitedAt: ago(3 * DAY) });
    expect(who({ signups: [s], accounts: [account("eva", { consentAt: null })] })).toEqual(["B eva@x.hu"]);
  });
});

describe("B: first login, registration not finished", () => {
  const unfinished = (v: Partial<ReminderAccount> = {}) => account("bela", { consentAt: null, createdAt: ago(25 * HOUR), ...v });

  it("is reminded 24 hours after the account was started", () => {
    expect(who({ accounts: [unfinished()] })).toEqual(["B bela@x.hu"]);
    expect(who({ accounts: [unfinished({ createdAt: ago(23 * HOUR) })] })).toEqual([]);
  });

  it("skips Admins, email switched off and suppressed addresses", () => {
    expect(who({ accounts: [unfinished({ admin: true })] })).toEqual([]);
    expect(who({ accounts: [unfinished({ emailOff: true })] })).toEqual([]);
    expect(who({ accounts: [unfinished()], suppressed: new Set(["bela@x.hu"]) })).toEqual([]);
  });

  it("skips someone whose signups are all in cities without a league", () => {
    expect(who({ accounts: [unfinished()], signups: [signup({ email1: "bela@x.hu", city: "other" })] })).toEqual([]);
    expect(who({ accounts: [unfinished()], signups: [signup({ email1: "bela@x.hu" })] })).toEqual(["B bela@x.hu"]);
  });
});

describe("C: registered, no pair", () => {
  it("is reminded 2 days after registering", () => {
    expect(who({ accounts: [account("cili")] })).toEqual(["C cili@x.hu"]);
    expect(who({ accounts: [account("cili", { consentAt: ago(DAY) })] })).toEqual([]);
  });

  it("skips players with a pair, and players looking for a partner (Párt keresek)", () => {
    expect(who({ accounts: [account("cili"), account("dani")], pairs: [pair("cili", "dani")], entries: [{ seasonId: 7, pairId: nextPair - 1 }] })).toEqual([]);
    expect(who({ accounts: [account("cili")], partnerSearches: [{ leagueId: 1, userId: "cili", seeking: true, updatedAt: ago(5 * DAY) }] })).toEqual([]);
    // A solo signup still waiting is looking by default.
    expect(who({ accounts: [account("cili")], signups: [signup({ email1: "cili@x.hu", mode: "solo" })] })).toEqual([]);
  });

  it("starts the 2 days again when the pair is dissolved or Párt keresek is switched off", () => {
    expect(who({ accounts: [account("cili"), account("dani")], pairs: [pair("cili", "dani", { status: "dissolved", dissolvedAt: ago(DAY) })] })).toEqual([]);
    const off = { leagueId: 1, userId: "cili", seeking: false, updatedAt: ago(DAY) };
    expect(who({ accounts: [account("cili")], partnerSearches: [off] })).toEqual([]);
    expect(who({ accounts: [account("cili")], partnerSearches: [{ ...off, updatedAt: ago(2 * DAY) }] })).toEqual(["C cili@x.hu"]);
  });

  it("names the partner the signup names who hasn't registered", () => {
    const s = signup({ mode: "pair", email1: "cili@x.hu", name2: "Dani", email2: "dani@x.hu" });
    expect(due({ accounts: [account("cili")], signups: [s] })[0].recipients[0].partner).toBe("Dani");
    // Without an address too.
    const noEmail = signup({ mode: "pair", email1: "cili@x.hu", name2: "Dani" });
    expect(due({ accounts: [account("cili")], signups: [noEmail] })[0].recipients[0].partner).toBe("Dani");
    expect(due({ accounts: [account("cili")] })[0].recipients[0].partner).toBeNull();
  });

  it("skips Admins and email switched off", () => {
    expect(who({ accounts: [account("cili", { admin: true })] })).toEqual([]);
    expect(who({ accounts: [account("cili", { emailOff: true })] })).toEqual([]);
  });
});

describe("D: a pair that hasn't entered", () => {
  const players = () => [account("dani"), account("erik")];

  it("goes to both players once per pair and season, 2 days after the pair formed", () => {
    const p = pair("dani", "erik");
    const [r] = due({ accounts: players(), pairs: [p] });
    expect(r.key).toBe(reminderKey("D", p.id, 7));
    expect(r.recipients).toEqual([
      { email: "dani@x.hu", name: "Dani", userId: "dani", partner: "Erik" },
      { email: "erik@x.hu", name: "Erik", userId: "erik", partner: "Dani" },
    ]);
    expect(who({ accounts: players(), pairs: [pair("dani", "erik", { createdAt: ago(DAY) })] })).toEqual([]);
  });

  it("counts from the registration opening for an older pair", () => {
    const opens = season({ registrationOpensAt: ago(DAY) });
    expect(who({ accounts: players(), pairs: [pair("dani", "erik", { createdAt: ago(30 * DAY) })], seasons: [opens] })).toEqual([]);
  });

  it("skips a pair with any entry: waiting for approval, approved or rejected", () => {
    const p = pair("dani", "erik");
    expect(who({ accounts: players(), pairs: [p], entries: [{ seasonId: 7, pairId: p.id }] })).toEqual([]);
  });

  it("leaves out a player who can't get it, and keeps the other", () => {
    const p = pair("dani", "erik");
    expect(who({ accounts: [account("dani", { emailOff: true }), account("erik")], pairs: [p] })).toEqual(["D erik@x.hu"]);
    expect(who({ accounts: players(), pairs: [p], suppressed: new Set(["dani@x.hu", "erik@x.hu"]) })).toEqual([]);
  });

  it("is sent once: a pair that stays stuck gets no second one", () => {
    const p = pair("dani", "erik");
    expect(who({ accounts: players(), pairs: [p], sent: new Set([reminderKey("D", p.id, 7)]) })).toEqual([]);
    // The next season is a new situation.
    expect(who({ accounts: players(), pairs: [p], sent: new Set([reminderKey("D", p.id, 6)]) })).toHaveLength(2);
  });
});

describe("once only, one per person, and the switch", () => {
  it("never repeats a reminder, even after falling back into the situation", () => {
    expect(who({ accounts: [account("cili")], sent: new Set(["C:cili"]) })).toEqual([]);
    expect(
      who({
        accounts: [account("cili"), account("dani")],
        pairs: [pair("cili", "dani", { status: "dissolved", dissolvedAt: ago(5 * DAY) })],
        sent: new Set(["C:cili", "C:dani"]),
      }),
    ).toEqual([]);
  });

  it("someone due in two situations gets only the earlier one's; the other comes on a later run", () => {
    // Cili has no pair in league 1 (C) and a pair without an entry in league 2 (D).
    const leagues = [
      { id: 1, city: "gyor", name: "Győr A" },
      { id: 2, city: "gyor", name: "Győr B" },
    ];
    const seasons = [season(), season({ id: 8, leagueId: 2 })];
    const v = { leagues, seasons, accounts: [account("cili"), account("dani")], pairs: [pair("cili", "dani", { leagueId: 2 })] };
    // Dani has a pair in league 2 but none in league 1 either: C for both.
    expect(who(v, [1, 2])).toEqual(["C cili@x.hu", "C dani@x.hu"]);
    expect(countBySituation(due(v, [1, 2]))).toEqual({ A: 0, B: 0, C: 2, D: 0 });
    expect(who({ ...v, sent: new Set(["C:cili", "C:dani"]) }, [1, 2])).toEqual(["D cili@x.hu", "D dani@x.hu"]);
  });

  it("counts each person in at most one reminder", () => {
    const v = {
      signups: [
        signup({ email1: "eva@x.hu", invitedAt: ago(3 * DAY) }),
        signup({ mode: "pair" as const, email1: "cili@x.hu", name2: "Dani", email2: "dani@x.hu", invitedAt: ago(3 * DAY), invited2At: ago(3 * DAY) }),
      ],
      accounts: [account("bela", { consentAt: null, createdAt: ago(2 * DAY) }), account("cili"), account("gabi"), account("hedi")],
      pairs: [pair("gabi", "hedi")],
    };
    const r = due(v);
    expect(who(v)).toEqual(["A dani@x.hu", "A eva@x.hu", "B bela@x.hu", "C cili@x.hu", "D gabi@x.hu", "D hedi@x.hu"]);
    const emails = r.flatMap((x) => x.recipients.map((p) => p.email));
    expect(new Set(emails).size).toBe(emails.length);
    expect(countBySituation(r)).toEqual({ A: 2, B: 1, C: 1, D: 2 });
  });

  it("sends nothing in a league with the switch off", () => {
    expect(who({ accounts: [account("cili")] }, [])).toEqual([]);
  });
});

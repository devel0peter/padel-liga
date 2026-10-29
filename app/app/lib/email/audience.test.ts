import { describe, expect, it } from "vitest";

import { audienceLabel, inviteRecipients, inviteStarts, signupRecipients, type InviteCandidate } from "./audience";

const GYOR = [{ slug: "gyor", name: "Győr" }];

const none = { city: "", status: "", level: "", mode: "", ref: "", club: "", q: "" };

describe("signupRecipients", () => {
  it("takes only the signer, never the partner (broadcasts)", () => {
    const { recipients } = signupRecipients([{ name1: "Anna", email1: "anna@example.com" }], new Set());
    expect(recipients).toEqual([{ name: "Anna", email: "anna@example.com" }]);
  });

  it("dedupes addresses case-insensitively, keeping the first", () => {
    const { recipients } = signupRecipients(
      [
        { name1: "Anna", email1: "anna@example.com" },
        { name1: "Anna 2", email1: "ANNA@example.com" },
      ],
      new Set(),
    );
    expect(recipients).toEqual([{ name: "Anna", email: "anna@example.com" }]);
  });

  it("skips and counts unsubscribed addresses", () => {
    const r = signupRecipients(
      [
        { name1: "Anna", email1: "anna@example.com" },
        { name1: "Béla", email1: "bela@example.com" },
      ],
      new Set(["bela@example.com"]),
    );
    expect(r.recipients.map((x) => x.email)).toEqual(["anna@example.com"]);
    expect(r.suppressed).toBe(1);
  });
});

describe("audienceLabel", () => {
  it("says everyone without filters", () => {
    expect(audienceLabel(none)).toBe("Minden jelentkező");
  });

  it("lists the filters in Hungarian", () => {
    expect(audienceLabel({ ...none, city: "gyor", status: "new", level: "kezdo", mode: "solo" }, GYOR)).toBe(
      "Jelentkezők: Győr · Új · Kezdő · Egyéni",
    );
    expect(audienceLabel({ ...none, city: "other", q: "pécs" })).toBe("Jelentkezők: Más város · „pécs”");
    expect(audienceLabel({ ...none, ref: "gyp" })).toBe("Jelentkezők: Forrás: gyp");
    expect(audienceLabel({ ...none, ref: "none" })).toBe("Jelentkezők: Forrás nélkül");
    expect(audienceLabel({ ...none, club: "gyp" })).toBe("Jelentkezők: Klub: gyp");
  });
});

describe("inviteRecipients", () => {
  let nextId = 1;
  const pair = (over: Partial<InviteCandidate> = {}): InviteCandidate => ({
    id: nextId++,
    mode: "pair",
    name1: "Anna",
    email1: "anna@example.com",
    name2: "Béla",
    email2: "bela@example.com",
    city: "gyor",
    status: "new",
    pairedWith: null,
    createdAt: new Date("2026-10-01T10:00:00Z"),
    invitedAt: null,
    invited2At: null,
    ...over,
  });
  const solo = (over: Partial<InviteCandidate> = {}) => pair({ mode: "solo", name2: null, email2: null, ...over });
  // Two solo rows a Szervező paired: both point at each other.
  const soloDuo = (a: Partial<InviteCandidate> = {}, b: Partial<InviteCandidate> = {}) => {
    const x = solo({ name1: "Cili", email1: "cili@example.com", ...a });
    const y = solo({ name1: "Dani", email1: "dani@example.com", ...b });
    x.pairedWith = y.id;
    y.pairedWith = x.id;
    return [x, y];
  };
  const ctx = { leagueCities: new Set(["gyor"]), suppressed: new Set<string>(), accounts: new Set<string>() };
  const emails = (rows: InviteCandidate[], c = ctx) => inviteRecipients(rows, c).map((r) => r.email);

  it("invites both addresses of a pair signup, each by their own name, once each", () => {
    expect(inviteRecipients([pair()], ctx)).toEqual([
      { name: "Anna", email: "anna@example.com", city: "gyor" },
      { name: "Béla", email: "bela@example.com", city: "gyor" },
    ]);
    // The same pair signed up twice, the second time the other way round.
    expect(
      emails([pair(), pair({ name1: "Béla", email1: "BELA@example.com", name2: "Anna", email2: "anna@example.com" })]),
    ).toEqual(["anna@example.com", "bela@example.com"]);
  });

  it("invites only the signer of a pair signup without a partner email, with the extra sentence (#96)", () => {
    expect(inviteRecipients([pair({ email2: null })], ctx)).toEqual([
      { name: "Anna", email: "anna@example.com", city: "gyor", variant: "no_partner_email" },
    ]);
    expect(inviteRecipients([pair({ email2: "" })], ctx)).toEqual([
      { name: "Anna", email: "anna@example.com", city: "gyor", variant: "no_partner_email" },
    ]);
  });

  it("invites each address once, case-insensitively", () => {
    expect(emails([pair({ email2: null }), pair({ email1: "ANNA@example.com", name1: "Anna 2", email2: null })])).toEqual([
      "anna@example.com",
    ]);
  });

  it("invites both solos once a Szervező paired them", () => {
    expect(inviteRecipients(soloDuo(), ctx)).toEqual([
      { name: "Cili", email: "cili@example.com", city: "gyor" },
      { name: "Dani", email: "dani@example.com", city: "gyor" },
    ]);
  });

  it("invites a solo still waiting for a partner too, with the solo text (#96)", () => {
    expect(inviteRecipients([solo({ email1: "solo@example.com" })], ctx)).toEqual([
      { name: "Anna", email: "solo@example.com", city: "gyor", variant: "solo" },
    ]);
    // Only one row pointing at the other is no pairing.
    const [x, y] = soloDuo();
    y.pairedWith = null;
    expect(inviteRecipients([x, y], ctx).map((r) => r.variant)).toEqual(["solo", "solo"]);
    // A partner who withdrew leaves the other waiting.
    expect(inviteRecipients(soloDuo({}, { status: "withdrawn" }), ctx)).toEqual([
      { name: "Cili", email: "cili@example.com", city: "gyor", variant: "solo" },
    ]);
  });

  it("skips signups in a city without a league, and 'other' cities", () => {
    expect(emails([pair({ city: "pecs" }), pair({ city: "other", email1: "b@example.com", email2: null })])).toEqual([]);
    expect(emails(soloDuo({ city: "pecs" }, { city: "pecs" }))).toEqual([]);
  });

  it("skips withdrawn signups", () => {
    expect(emails([pair({ status: "withdrawn" })])).toEqual([]);
    expect(
      emails([pair({ status: "contacted", email2: null }), pair({ status: "paired", email1: "b@example.com", email2: null })]),
    ).toEqual(["anna@example.com", "b@example.com"]);
  });

  it("skips unsubscribed or bounced addresses, of either player", () => {
    expect(emails([pair()], { ...ctx, suppressed: new Set(["anna@example.com"]) })).toEqual(["bela@example.com"]);
    expect(emails([pair()], { ...ctx, suppressed: new Set(["bela@example.com"]) })).toEqual(["anna@example.com"]);
  });

  it("skips addresses that already have an account", () => {
    expect(emails([pair({ email1: "Anna@Example.com" })], { ...ctx, accounts: new Set(["anna@example.com"]) })).toEqual([
      "bela@example.com",
    ]);
    expect(emails(soloDuo(), { ...ctx, accounts: new Set(["dani@example.com"]) })).toEqual(["cili@example.com"]);
  });

  it("skips an address already invited, through any of its signups, as signer or partner", () => {
    const invitedAt = new Date("2026-11-02T08:00:00Z");
    expect(emails([pair({ invitedAt })])).toEqual(["bela@example.com"]);
    expect(emails([pair({ invited2At: invitedAt })])).toEqual(["anna@example.com"]);
    // A second signup of the same address (e.g. another city) doesn't bring it back.
    expect(
      emails([pair({ email2: null }), pair({ email1: "ANNA@example.com", email2: null, city: "pecs", invitedAt })]),
    ).toEqual([]);
    // Invited as the partner of one signup, it isn't invited again as the signer of another.
    expect(emails([pair({ invitedAt, invited2At: invitedAt }), ...soloDuo({ email1: "bela@example.com" })])).toEqual([
      "dani@example.com",
    ]);
  });
});

describe("inviteStarts (#131)", () => {
  // Rounds start Monday 00:00 Budapest and end Sunday 23:59.
  const round = (number: number, start: string, end: string) => ({
    number,
    startsAt: new Date(`${start}T23:00:00Z`),
    deadline: new Date(`${end}T22:59:00Z`),
  });
  const autumn = { leagueId: 1, phases: [round(1, "2026-11-08", "2026-11-29"), round(2, "2026-11-29", "2026-12-20")] };
  const spring = { leagueId: 1, phases: [round(1, "2027-02-28", "2027-03-21")] };
  const leagues = [{ id: 1, city: "gyor" }];
  const cities = [{ slug: "gyor", name: "Győr" }];
  const on = (iso: string) => new Date(iso);

  it("gives each league city its name and the current season's first round start", () => {
    const starts = inviteStarts(leagues, [spring, autumn], cities, on("2026-10-30T10:00:00Z"));
    expect([...starts]).toEqual([["gyor", { city: "Győr", firstRound: new Date("2026-11-08T23:00:00Z") }]]);
  });

  it("has nothing for a city whose league has no season", () => {
    expect(inviteStarts(leagues, [], cities, on("2026-10-30T10:00:00Z")).size).toBe(0);
  });

  it("has nothing once the current season's first round has started", () => {
    expect(inviteStarts(leagues, [autumn, spring], cities, on("2026-11-09T08:00:00Z")).size).toBe(0);
  });

  it("takes the next season once the current one has ended", () => {
    const starts = inviteStarts(leagues, [autumn, spring], cities, on("2027-01-10T10:00:00Z"));
    expect(starts.get("gyor")?.firstRound).toEqual(new Date("2027-02-28T23:00:00Z"));
  });

  it("takes the first league of a city that has a season", () => {
    const two = [
      { id: 1, city: "gyor" },
      { id: 2, city: "gyor" },
    ];
    const starts = inviteStarts(two, [{ ...autumn, leagueId: 2 }], cities, on("2026-10-30T10:00:00Z"));
    expect(starts.get("gyor")?.firstRound).toEqual(new Date("2026-11-08T23:00:00Z"));
  });
});

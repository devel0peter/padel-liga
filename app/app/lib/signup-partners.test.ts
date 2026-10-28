import { describe, expect, it } from "vitest";

import { checkPartnerEmail, PARTNER_EMAIL_REFUSALS, partnerWithoutEmail, signupPartners, waitingMessage, type SignupLink } from "./signup-partners";

describe("waitingMessage", () => {
  it("names the partner, nothing else", () => {
    expect(waitingMessage("Béla")).toBe("A párod, Béla, még nem regisztrált.");
  });
});

let nextId = 1;
const row = (over: Partial<SignupLink> = {}): SignupLink => ({
  id: nextId++,
  mode: "pair",
  city: "gyor",
  status: "new",
  name1: "Anna",
  email1: "anna@x.hu",
  name2: "Béla",
  email2: "bela@x.hu",
  pairedWith: null,
  createdAt: new Date("2026-10-01T10:00:00Z"),
  ...over,
});
const soloDuo = (a: Partial<SignupLink> = {}, b: Partial<SignupLink> = {}) => {
  const x = row({ mode: "solo", name1: "Cili", email1: "cili@x.hu", name2: null, email2: null, ...a });
  const y = row({ mode: "solo", name1: "Dani", email1: "dani@x.hu", name2: null, email2: null, ...b });
  x.pairedWith = y.id;
  y.pairedWith = x.id;
  return [x, y];
};

describe("signupPartners", () => {
  it("names the other address of a pair signup, from either side", () => {
    expect(signupPartners([row()], "anna@x.hu")).toEqual([{ city: "gyor", name: "Béla", email: "bela@x.hu" }]);
    expect(signupPartners([row()], "BELA@x.hu")).toEqual([{ city: "gyor", name: "Anna", email: "anna@x.hu" }]);
    expect(signupPartners([row()], "cili@x.hu")).toEqual([]);
  });

  it("names the solo a Szervező paired them with", () => {
    expect(signupPartners(soloDuo(), "cili@x.hu")).toEqual([{ city: "gyor", name: "Dani", email: "dani@x.hu" }]);
    expect(signupPartners(soloDuo(), "dani@x.hu")).toEqual([{ city: "gyor", name: "Cili", email: "cili@x.hu" }]);
  });

  it("names nobody for a solo still waiting, or paired one way only", () => {
    expect(signupPartners([row({ mode: "solo", email1: "cili@x.hu", email2: null })], "cili@x.hu")).toEqual([]);
    const [x, y] = soloDuo();
    y.pairedWith = null;
    expect(signupPartners([x, y], "cili@x.hu")).toEqual([]);
  });

  it("ignores withdrawn signups, on either side of a solo pairing", () => {
    expect(signupPartners([row({ status: "withdrawn" })], "anna@x.hu")).toEqual([]);
    expect(signupPartners(soloDuo({}, { status: "withdrawn" }), "cili@x.hu")).toEqual([]);
    expect(signupPartners(soloDuo({ status: "withdrawn" }), "cili@x.hu")).toEqual([]);
  });

  it("leaves out a partner entered without an email, or with their own", () => {
    expect(signupPartners([row({ email2: null })], "anna@x.hu")).toEqual([]);
    expect(signupPartners([row({ email2: "ANNA@x.hu" })], "anna@x.hu")).toEqual([]);
  });

  it("takes the newest signup per city", () => {
    const old = row({ createdAt: new Date("2026-09-01T10:00:00Z") });
    const newer = row({ name2: "Ede", email2: "ede@x.hu", createdAt: new Date("2026-10-10T10:00:00Z") });
    const elsewhere = row({ city: "deb", createdAt: new Date("2026-08-01T10:00:00Z") });
    expect(signupPartners([old, newer, elsewhere], "anna@x.hu")).toEqual([
      { city: "gyor", name: "Ede", email: "ede@x.hu" },
      { city: "deb", name: "Béla", email: "bela@x.hu" },
    ]);
    // Withdrawn signups don't count, so the older one decides again.
    expect(signupPartners([old, { ...newer, status: "withdrawn" }], "anna@x.hu")).toEqual([
      { city: "gyor", name: "Béla", email: "bela@x.hu" },
    ]);
  });

  it("puts their own signups before ones where someone else named them", () => {
    // Béla signed up with Cili; Anna later entered Béla as her partner.
    const own = row({ name1: "Béla", email1: "bela@x.hu", name2: "Cili", email2: "cili@x.hu", createdAt: new Date("2026-09-01T10:00:00Z") });
    const named = row({ createdAt: new Date("2026-10-10T10:00:00Z") });
    expect(signupPartners([own, named], "bela@x.hu")).toEqual([{ city: "gyor", name: "Cili", email: "cili@x.hu" }]);
    // An own solo signup, still waiting, says "nobody" too.
    const soloOwn = row({ mode: "solo", name1: "Béla", email1: "bela@x.hu", name2: null, email2: null });
    expect(signupPartners([soloOwn, named], "bela@x.hu")).toEqual([]);
    // Without an own signup, being named decides.
    expect(signupPartners([named], "bela@x.hu")).toEqual([{ city: "gyor", name: "Anna", email: "anna@x.hu" }]);
  });

  it("names nobody when the newest signup names nobody, even if an older one did", () => {
    const old = row({ createdAt: new Date("2026-09-01T10:00:00Z") });
    const soloNow = row({ mode: "solo", name2: null, email2: null, createdAt: new Date("2026-10-10T10:00:00Z") });
    expect(signupPartners([old, soloNow], "anna@x.hu")).toEqual([]);
    const noEmail = row({ email2: null, createdAt: new Date("2026-10-10T10:00:00Z") });
    expect(signupPartners([old, noEmail], "anna@x.hu")).toEqual([]);
  });
});

describe("partnerWithoutEmail (#96)", () => {
  it("finds the player's own pair signup that names a partner without an email: the name, never an address", () => {
    const r = row({ email2: null });
    expect(partnerWithoutEmail([r], "ANNA@x.hu")).toEqual([{ signupId: r.id, city: "gyor", name: "Béla" }]);
    const empty = row({ email2: "  " });
    expect(partnerWithoutEmail([empty], "anna@x.hu")).toEqual([{ signupId: empty.id, city: "gyor", name: "Béla" }]);
  });

  it("finds nothing for a partner with an email, a solo, a withdrawn signup or a nameless partner", () => {
    expect(partnerWithoutEmail([row()], "anna@x.hu")).toEqual([]);
    expect(partnerWithoutEmail([row({ mode: "solo", name2: null, email2: null })], "anna@x.hu")).toEqual([]);
    expect(partnerWithoutEmail([row({ email2: null, status: "withdrawn" })], "anna@x.hu")).toEqual([]);
    expect(partnerWithoutEmail([row({ email2: null, name2: " " })], "anna@x.hu")).toEqual([]);
  });

  it("only the player's own signup counts: being the named partner shows nothing", () => {
    expect(partnerWithoutEmail([row({ email2: null })], "bela@x.hu")).toEqual([]);
  });

  it("takes the newest own signup per city, as for the pair", () => {
    const old = row({ email2: null, createdAt: new Date("2026-09-01T10:00:00Z") });
    const newer = row({ createdAt: new Date("2026-10-10T10:00:00Z") });
    expect(partnerWithoutEmail([old, newer], "anna@x.hu")).toEqual([]);
    expect(partnerWithoutEmail([{ ...old, createdAt: new Date("2026-10-11T10:00:00Z") }, newer], "anna@x.hu")).toHaveLength(1);
    const elsewhere = row({ city: "deb", email2: null });
    expect(partnerWithoutEmail([newer, elsewhere], "anna@x.hu")).toEqual([{ signupId: elsewhere.id, city: "deb", name: "Béla" }]);
  });
});

describe("checkPartnerEmail (#96)", () => {
  const ok = { email: " Bela@X.hu ", userEmail: "anna@x.hu", paired: false };

  it("accepts and normalizes another player's address", () => {
    expect(checkPartnerEmail(ok)).toEqual({ ok: true, email: "bela@x.hu" });
  });

  it("refuses an invalid address, your own (any case), or one already paired in the league", () => {
    expect(checkPartnerEmail({ ...ok, email: "nem cím" })).toEqual({ ok: false, error: PARTNER_EMAIL_REFUSALS.email });
    expect(checkPartnerEmail({ ...ok, email: "ANNA@x.hu" })).toEqual({ ok: false, error: PARTNER_EMAIL_REFUSALS.self });
    expect(checkPartnerEmail({ ...ok, paired: true })).toEqual({ ok: false, error: PARTNER_EMAIL_REFUSALS.paired });
  });

  it("says why in Hungarian", () => {
    for (const text of Object.values(PARTNER_EMAIL_REFUSALS)) expect(text).toMatch(/[áéíóöőúüű]/);
  });
});

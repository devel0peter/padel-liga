import { describe, expect, it } from "vitest";

import { signupPartners, waitingMessage, type SignupLink } from "./signup-partners";

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

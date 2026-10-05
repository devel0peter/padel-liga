import { describe, expect, it } from "vitest";

import { parseInterest } from "./interest";

const GYOR = [{ slug: "gyor", name: "Győr" }];

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const pair = {
  city: "gyor",
  mode: "pair",
  name1: "Nagy Anna",
  email1: "anna@example.com",
  name2: "Kovács Béla",
  email2: "",
  level: "kozephalado",
  note: "",
  consent: "on",
};

describe("parseInterest", () => {
  it("accepts a valid pair signup and normalizes it", () => {
    const r = parseInterest(form({ ...pair, name1: "  Nagy Anna ", email1: "Anna@Example.com" }), [], GYOR);
    expect(r).toEqual({
      ok: true,
      data: {
        city: "gyor",
        cityOther: null,
        mode: "pair",
        name1: "Nagy Anna",
        email1: "anna@example.com",
        name2: "Kovács Béla",
        email2: null,
        level: "kozephalado",
        note: null,
        ref: null,
        homeClub: null,
      },
    });
  });

  it("keeps a known home club or 'other' and drops anything else", () => {
    const clubs = ["gyp", "arkad"];
    expect(parseInterest(form({ ...pair, homeClub: "gyp" }), clubs, GYOR)).toMatchObject({ ok: true, data: { homeClub: "gyp" } });
    expect(parseInterest(form({ ...pair, homeClub: "other" }), clubs, GYOR)).toMatchObject({ ok: true, data: { homeClub: "other" } });
    expect(parseInterest(form({ ...pair, homeClub: "nope" }), clubs, GYOR)).toMatchObject({ ok: true, data: { homeClub: null } });
    expect(parseInterest(form({ ...pair, homeClub: "gyp" }), [], GYOR)).toMatchObject({ ok: true, data: { homeClub: null } });
  });

  it("ignores the home club for a city without a league", () => {
    const r = parseInterest(form({ ...pair, city: "other", cityOther: "Szeged", homeClub: "gyp" }), ["gyp"], GYOR);
    expect(r).toMatchObject({ ok: true, data: { homeClub: null } });
  });

  it("keeps a valid ref and drops a malformed one", () => {
    expect(parseInterest(form({ ...pair, ref: "Gyor-Padel" }), [], GYOR)).toMatchObject({ ok: true, data: { ref: "gyor-padel" } });
    expect(parseInterest(form({ ...pair, ref: "<b>" }), [], GYOR)).toMatchObject({ ok: true, data: { ref: null } });
  });

  it("drops partner fields for a solo signup", () => {
    const r = parseInterest(form({ ...pair, mode: "solo", name2: "x", email2: "bad" }), [], GYOR);
    expect(r.ok && r.data).toMatchObject({ mode: "solo", name2: null, email2: null });
  });

  it("treats a missing or unknown mode as pair", () => {
    const { mode: _, ...noMode } = pair;
    expect(parseInterest(form({ ...noMode, name2: "" }), [], GYOR).ok).toBe(false);
    expect(parseInterest(form({ ...pair, mode: "trio" }), [], GYOR).ok).toBe(true);
  });

  it("requires name, valid email, level and consent", () => {
    const r = parseInterest(form({ city: "gyor", mode: "solo" }), [], GYOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["consent", "email1", "level", "name1"]);
  });

  it("requires the partner's name for a pair", () => {
    const r = parseInterest(form({ ...pair, name2: " " }), [], GYOR);
    expect(!r.ok && r.errors.name2).toBeTruthy();
  });

  it("rejects an invalid or duplicate partner email", () => {
    const bad = parseInterest(form({ ...pair, email2: "nope" }), [], GYOR);
    expect(!bad.ok && bad.errors.email2).toBe("A párod e-mail-címe nem érvényes.");
    const same = parseInterest(form({ ...pair, email2: "ANNA@example.com" }), [], GYOR);
    expect(!same.ok && same.errors.email2).toBeTruthy();
  });

  it("requires a supported city", () => {
    const { city: _, ...noCity } = pair;
    expect(!parseInterest(form(noCity), [], GYOR).ok).toBe(true);
    const r = parseInterest(form({ ...pair, city: "budapest" }), [], GYOR);
    expect(!r.ok && r.errors.city).toBe("Válaszd ki a várost.");
  });

  it("accepts another city with its name", () => {
    const r = parseInterest(form({ ...pair, city: "other", cityOther: " Szeged " }), [], GYOR);
    expect(r.ok && r.data).toMatchObject({ city: "other", cityOther: "Szeged" });
  });

  it("requires the name of the other city", () => {
    const r = parseInterest(form({ ...pair, city: "other", cityOther: "" }), [], GYOR);
    expect(!r.ok && r.errors.cityOther).toBeTruthy();
  });

  it("files a typed supported city under that city", () => {
    const r = parseInterest(form({ ...pair, city: "other", cityOther: "gyor" }), [], GYOR);
    expect(r.ok && r.data).toMatchObject({ city: "gyor", cityOther: null });
  });

  it("ignores cityOther when a supported city is picked", () => {
    const r = parseInterest(form({ ...pair, cityOther: "Szeged" }), [], GYOR);
    expect(r.ok && r.data).toMatchObject({ city: "gyor", cityOther: null });
  });

  it("rejects an unknown level", () => {
    const r = parseInterest(form({ ...pair, level: "pro" }), [], GYOR);
    expect(!r.ok && r.errors.level).toBeTruthy();
  });

  it("rejects over-long fields", () => {
    const r = parseInterest(form({ ...pair, name1: "a".repeat(101), note: "x".repeat(1001) }), [], GYOR);
    expect(!r.ok && Object.keys(r.errors).sort()).toEqual(["name1", "note"]);
  });
});

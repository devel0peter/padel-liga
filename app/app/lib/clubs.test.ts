import { describe, expect, it } from "vitest";

import { countBy, homeClubLabel, normalizeRef, parseClub, posterUrl, refLabel, slugify, toClubOption } from "./clubs";

const GYOR = [{ slug: "gyor", name: "Győr" }];

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const club = {
  name: "Győr Padel Klub",
  slug: "",
  city: "gyor",
  adminNote: "",
};

describe("slugify", () => {
  it("strips accents and joins words with hyphens", () => {
    expect(slugify("Győr Padel Klub")).toBe("gyor-padel-klub");
    expect(slugify("  Árkád & Padel!  ")).toBe("arkad-padel");
  });

  it("caps the length without a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(39)} b`);
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("normalizeRef", () => {
  it("lowercases and trims a valid ref", () => {
    expect(normalizeRef(" Gyor-Padel ")).toBe("gyor-padel");
  });

  it("drops a missing or malformed ref", () => {
    for (const bad of [null, undefined, "", "-x", "x-", "a b", "<script>", "a".repeat(41)])
      expect(normalizeRef(bad)).toBeNull();
  });
});

describe("parseClub", () => {
  it("accepts a valid club and makes the slug from the name", () => {
    expect(parseClub(form(club), GYOR)).toEqual({
      ok: true,
      data: { name: "Győr Padel Klub", slug: "gyor-padel-klub", city: "gyor", adminNote: null },
    });
  });

  it("rejects 'other' as a slug, since it means 'Máshol / vegyesen'", () => {
    const r = parseClub(form({ ...club, slug: "other" }), GYOR);
    expect(r.ok).toBe(false);
  });

  it("keeps a typed slug, lowercased", () => {
    const r = parseClub(form({ ...club, slug: "GYP" }), GYOR);
    expect(r.ok && r.data.slug).toBe("gyp");
  });

  it("rejects a missing name, bad slug and unknown city", () => {
    const r = parseClub(form({ name: "", slug: "a b", city: "pest" }), GYOR);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["city", "name", "slug"]);
  });
});

describe("countBy", () => {
  it("counts signups per value, with no value under the empty key", () => {
    expect(countBy([{ ref: "a" }, { ref: null }, { ref: "a" }, { ref: "b" }], "ref")).toEqual({ a: 2, b: 1, "": 1 });
  });
});

describe("refLabel", () => {
  const clubs = [{ slug: "gyp", name: "Győr Padel" }];
  it("shows the club name for a club ref and the raw ref otherwise", () => {
    expect(refLabel("gyp", clubs)).toBe("Győr Padel");
    expect(refLabel("verseny", clubs)).toBe("verseny");
    expect(refLabel(null, clubs)).toBe("");
  });

  it("names the home club, 'other', or nothing", () => {
    expect(homeClubLabel("gyp", clubs)).toBe("Győr Padel");
    expect(homeClubLabel("other", clubs)).toBe("Máshol / vegyesen");
    expect(homeClubLabel(null, clubs)).toBe("");
  });
});

describe("club data", () => {
  it("gives the signup form no admin fields", () => {
    const option = toClubOption({ id: 1, slug: "gyp", city: "gyor", name: "GYP", adminNote: "secret" });
    expect(option).toEqual({ slug: "gyp", city: "gyor", name: "GYP" });
  });

  it("builds the poster link from the slug", () => {
    expect(posterUrl("gyp")).toBe("https://padelparbaj.hu/?ref=gyp");
  });
});

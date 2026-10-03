import { describe, expect, it } from "vitest";

import { countByRef, normalizeRef, parseClub, posterUrl, refLabel, slugify, toPublicClub } from "./clubs";

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const club = {
  name: "Győr Padel Klub",
  slug: "",
  city: "gyor",
  address: "",
  bookingUrl: "https://sportmate.hu/klub",
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
    expect(parseClub(form({ ...club, listed: "on" }))).toEqual({
      ok: true,
      data: {
        name: "Győr Padel Klub",
        slug: "gyor-padel-klub",
        city: "gyor",
        address: null,
        bookingUrl: "https://sportmate.hu/klub",
        listed: true,
        adminNote: null,
      },
    });
  });

  it("is not listed unless the box is ticked", () => {
    const r = parseClub(form(club));
    expect(r.ok && r.data.listed).toBe(false);
  });

  it("keeps a typed slug, lowercased", () => {
    const r = parseClub(form({ ...club, slug: "GYP" }));
    expect(r.ok && r.data.slug).toBe("gyp");
  });

  it("rejects a missing name, bad slug, unknown city and non-http link", () => {
    const r = parseClub(form({ name: "", slug: "a b", city: "pest", bookingUrl: "javascript:alert(1)" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["bookingUrl", "city", "name", "slug"]);
  });
});

describe("countByRef", () => {
  it("counts signups per ref, with no ref under the empty key", () => {
    expect(countByRef([{ ref: "a" }, { ref: null }, { ref: "a" }, { ref: "b" }])).toEqual({ a: 2, b: 1, "": 1 });
  });
});

describe("refLabel", () => {
  const clubs = [{ slug: "gyp", name: "Győr Padel" }];
  it("shows the club name for a club ref and the raw ref otherwise", () => {
    expect(refLabel("gyp", clubs)).toBe("Győr Padel");
    expect(refLabel("verseny", clubs)).toBe("verseny");
    expect(refLabel(null, clubs)).toBe("");
  });
});

describe("public club data", () => {
  it("leaves out the admin fields", () => {
    const pub = toPublicClub({ id: 1, slug: "gyp", city: "gyor", name: "GYP", address: null, bookingUrl: null, listed: true, adminNote: "secret" });
    expect(pub).toEqual({ slug: "gyp", name: "GYP", address: null, bookingUrl: null });
  });

  it("builds the poster link from the slug", () => {
    expect(posterUrl("gyp")).toBe("https://padelparbaj.hu/?ref=gyp");
  });
});

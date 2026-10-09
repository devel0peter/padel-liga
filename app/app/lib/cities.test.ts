import { describe, expect, it } from "vitest";

import { cityName, findCity, isCity, matchesCity, OTHER_CITY, parseCity, playerCounts } from "./cities";

const cities = [
  { slug: "gyor", name: "Győr", listed: true },
  { slug: "debrecen", name: "Debrecen", listed: false },
];

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("city lookups", () => {
  it("knows a city by slug", () => {
    expect(isCity("gyor", cities)).toBe(true);
    expect(isCity("szeged", cities)).toBe(false);
    expect(isCity(OTHER_CITY, cities)).toBe(false);
  });

  it("matches a typed name without accents or case", () => {
    expect(findCity("  GYŐR ", cities)).toBe("gyor");
    expect(findCity("gyor", cities)).toBe("gyor");
    expect(findCity("debrecen", cities)).toBe("debrecen");
    expect(findCity("Szeged", cities)).toBeNull();
  });

  it("names a city, or shows an unknown slug as is", () => {
    expect(cityName("gyor", cities)).toBe("Győr");
    expect(cityName("pecs", cities)).toBe("pecs");
  });

  it("finds the 'Más város' signups typed as a new city", () => {
    const pecs = { slug: "pecs", name: "Pécs" };
    expect(matchesCity("pecs", pecs)).toBe(true);
    expect(matchesCity(" Pécs ", pecs)).toBe(true);
    expect(matchesCity("Pécsvárad", pecs)).toBe(false);
    expect(matchesCity(null, pecs)).toBe(false);
  });
});

describe("parseCity", () => {
  it("makes the slug from the name and reads the listed box", () => {
    expect(parseCity(form({ name: " Székesfehérvár ", slug: "", listed: "on" }))).toEqual({
      ok: true,
      data: { slug: "szekesfehervar", name: "Székesfehérvár", listed: true },
    });
    expect(parseCity(form({ name: "Pécs" }))).toEqual({ ok: true, data: { slug: "pecs", name: "Pécs", listed: false } });
  });

  it("rejects a missing name, a bad slug and 'other'", () => {
    const r = parseCity(form({ name: "", slug: "a b" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["name", "slug"]);
    const o = parseCity(form({ name: "Más", slug: "other" }));
    expect(!o.ok && o.errors.slug).toBeTruthy();
  });
});

describe("landing player counts", () => {
  it("counts a pair as two players and a solo as one", () => {
    const counts = playerCounts([
      { city: "gyor", mode: "pair", n: 20 },
      { city: "gyor", mode: "solo", n: 3 },
    ]);
    expect(counts.get("gyor")).toBe(43);
  });

  it("leaves out a city with too few players to show", () => {
    const counts = playerCounts([
      { city: "debrecen", mode: "pair", n: 5 },
      { city: "debrecen", mode: "solo", n: 1 },
      { city: "szeged", mode: "pair", n: 6 },
    ]);
    expect(counts.has("debrecen")).toBe(false);
    expect(counts.get("szeged")).toBe(12);
  });
});

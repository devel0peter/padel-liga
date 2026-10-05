import { describe, expect, it } from "vitest";

import { formatDay, formatPercent } from "./format";
import { budapestDay, buildFunnel, daysOf, landingSource, parsePeriod, withoutTracking } from "./traffic";

const params = (q: string) => new URLSearchParams(q);

describe("landingSource", () => {
  it("uses ?ref=, normalized like a signup ref", () => {
    expect(landingSource(params("ref=Gyor-Padel"))).toBe("gyor-padel");
  });

  it("falls back to ?utm_source= when there is no valid ref", () => {
    expect(landingSource(params("utm_source=facebook&utm_medium=paid"))).toBe("facebook");
    expect(landingSource(params("ref=bad%20ref&utm_source=ig"))).toBe("ig");
  });

  it("prefers ref over utm_source", () => {
    expect(landingSource(params("ref=plakat&utm_source=facebook"))).toBe("plakat");
  });

  it("is null without a usable source", () => {
    expect(landingSource(params(""))).toBeNull();
    expect(landingSource(params("fbclid=abc123"))).toBeNull();
    expect(landingSource(params("utm_source=Facebook Ads"))).toBeNull();
  });
});

describe("budapestDay", () => {
  it("uses the Budapest calendar day, not UTC", () => {
    // 23:30 UTC on 4 Oct is 01:30 on 5 Oct in Budapest (CEST, UTC+2).
    expect(budapestDay(new Date("2026-10-04T23:30:00Z"))).toBe("2026-10-05");
    expect(budapestDay(new Date("2026-10-04T21:59:00Z"))).toBe("2026-10-04");
  });

  it("follows winter time (UTC+1)", () => {
    expect(budapestDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(budapestDay(new Date("2026-12-31T22:59:00Z"))).toBe("2026-12-31");
  });
});

describe("parsePeriod", () => {
  const now = new Date("2026-10-05T10:00:00Z");

  it("defaults to the last 30 days ending today", () => {
    expect(parsePeriod(params(""), now)).toEqual({ from: "2026-09-06", to: "2026-10-05" });
  });

  it("takes valid from/to days", () => {
    expect(parsePeriod(params("from=2026-10-01&to=2026-10-03"), now)).toEqual({ from: "2026-10-01", to: "2026-10-03" });
  });

  it("ignores malformed days", () => {
    expect(parsePeriod(params("from=tegnap&to=2026-13-45"), now)).toEqual({ from: "2026-09-06", to: "2026-10-05" });
  });

  it("swaps a reversed range", () => {
    expect(parsePeriod(params("from=2026-10-03&to=2026-10-01"), now)).toEqual({ from: "2026-10-01", to: "2026-10-03" });
  });
});

describe("daysOf", () => {
  it("lists every day inclusive, across a month end", () => {
    expect(daysOf({ from: "2026-09-29", to: "2026-10-02" })).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });
});

describe("buildFunnel", () => {
  const period = { from: "2026-10-05", to: "2026-10-06" };
  const landings = [
    { day: "2026-10-05", ref: "fb", count: 40 },
    { day: "2026-10-06", ref: "fb", count: 40 },
    { day: "2026-10-05", ref: null, count: 20 },
    { day: "2026-10-05", ref: "gyor-padel", count: 5 },
    { day: "2026-10-04", ref: "fb", count: 999 }, // before the period
  ];
  const signups = [
    { createdAt: new Date("2026-10-05T08:00:00Z"), ref: "fb" },
    { createdAt: new Date("2026-10-06T08:00:00Z"), ref: "fb" },
    { createdAt: new Date("2026-10-05T09:00:00Z"), ref: "gyor-padel" },
    { createdAt: new Date("2026-10-05T10:00:00Z"), ref: null },
    // Signed up from a source with no counted landing (e.g. before tracking).
    { createdAt: new Date("2026-10-06T10:00:00Z"), ref: "verseny" },
    // 22:30 UTC on 6 Oct is 7 Oct in Budapest: outside the period.
    { createdAt: new Date("2026-10-06T22:30:00Z"), ref: "fb" },
  ];
  const funnel = buildFunnel(landings, signups, period);

  it("counts landings, signups and conversion per source", () => {
    expect(funnel.sources).toEqual([
      { ref: "fb", landings: 80, signups: 2, conversion: 0.025 },
      { ref: "gyor-padel", landings: 5, signups: 1, conversion: 0.2 },
      { ref: "verseny", landings: 0, signups: 1, conversion: null },
      { ref: null, landings: 20, signups: 1, conversion: 0.05 },
    ]);
  });

  it("totals the period", () => {
    expect(funnel.total).toEqual({ ref: null, landings: 105, signups: 5, conversion: 5 / 105 });
  });

  it("breaks the period down by Budapest day, including empty days", () => {
    expect(funnel.days).toEqual([
      { day: "2026-10-05", landings: 65, signups: 3 },
      { day: "2026-10-06", landings: 40, signups: 2 },
    ]);
    expect(buildFunnel([], [], period).days).toEqual([
      { day: "2026-10-05", landings: 0, signups: 0 },
      { day: "2026-10-06", landings: 0, signups: 0 },
    ]);
  });

  it("has no conversion without landings", () => {
    expect(buildFunnel([], [], period).total.conversion).toBeNull();
  });
});

describe("formatPercent / formatDay", () => {
  it("uses a decimal comma", () => {
    expect(formatPercent(0.125)).toBe("12,5%");
    expect(formatPercent(0.2)).toBe("20%");
  });

  it("shows a day as 'okt. 5., hétfő'", () => {
    expect(formatDay("2026-10-05")).toBe("okt. 5., hétfő");
  });
});

describe("withoutTracking", () => {
  it("drops our source tag, ad tags and click ids", () => {
    expect(withoutTracking("?ref=gyor-padel-klub")).toBe("");
    expect(withoutTracking("?utm_source=fb&utm_campaign=okt&fbclid=abc")).toBe("");
    expect(withoutTracking("?REF=x&gclid=1")).toBe("");
  });

  it("keeps anything else", () => {
    expect(withoutTracking("?ref=plakat&lang=hu")).toBe("?lang=hu");
    expect(withoutTracking("")).toBe("");
  });
});

import { describe, expect, it } from "vitest";

import { formatDay, formatPercent } from "./format";
import {
  budapestDay,
  buildFunnel,
  daysOf,
  isNewLanding,
  landingSource,
  parsePeriod,
  referrerSource,
  withoutTracking,
} from "./traffic";

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
    expect(landingSource(params("utm_source=Facebook Ads"))).toBeNull();
    expect(landingSource(params(""), "https://padelparbaj.hu/rules")).toBeNull();
    expect(landingSource(params(""), "https://example.com/")).toBeNull();
  });

  it("falls back to a known referrer when the link has no tag", () => {
    expect(landingSource(params(""), "https://l.facebook.com/")).toBe("facebook");
    expect(landingSource(params(""), "https://www.google.hu/")).toBe("google");
  });

  it("counts a Facebook click id without a tag or referrer as facebook", () => {
    // Facebook's in-app browser often sends no referrer.
    expect(landingSource(params("fbclid=abc123"))).toBe("facebook");
    expect(landingSource(params("fbclid=abc123"), "https://www.instagram.com/")).toBe("instagram");
  });

  it("prefers the link's tag over the referrer and click id", () => {
    expect(landingSource(params("ref=megosztas&fbclid=abc"), "https://facebook.com/")).toBe("megosztas");
    expect(landingSource(params("utm_source=ig"), "https://facebook.com/")).toBe("ig");
  });

  it("treats text glued to a tag as no tag", () => {
    // A post where "Jelöld..." stuck to the link: not a slug, so the click id decides.
    expect(landingSource(params("ref=padel-partner-gyor-fbJel%C3%B6ld&fbclid=x"))).toBe("facebook");
  });
});

describe("referrerSource", () => {
  it("maps Facebook's hosts, including the link shims and Messenger", () => {
    for (const r of ["https://facebook.com/", "https://l.facebook.com/", "http://m.facebook.com", "https://lm.facebook.com/", "https://www.messenger.com/"]) {
      expect(referrerSource(r)).toBe("facebook");
    }
  });

  it("maps Instagram and Google", () => {
    expect(referrerSource("https://l.instagram.com/")).toBe("instagram");
    expect(referrerSource("https://www.google.com/")).toBe("google");
  });

  it("is null for other sites, our own site, and no or bad referrer", () => {
    expect(referrerSource("https://notfacebook.com/")).toBeNull();
    expect(referrerSource("https://padelparbaj.hu/")).toBeNull();
    expect(referrerSource("")).toBeNull();
    expect(referrerSource(null)).toBeNull();
    expect(referrerSource("not a url")).toBeNull();
  });
});

describe("isNewLanding", () => {
  it("counts a normal navigation and an unknown type", () => {
    expect(isNewLanding("navigate")).toBe(true);
    expect(isNewLanding("prerender")).toBe(true);
    expect(isNewLanding(undefined)).toBe(true);
  });

  it("skips a reload and back or forward", () => {
    expect(isNewLanding("reload")).toBe(false);
    expect(isNewLanding("back_forward")).toBe(false);
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

describe("buildFunnel (landings only since #333)", () => {
  const period = { from: "2026-10-05", to: "2026-10-06" };
  const landings = [
    { day: "2026-10-05", ref: "fb", count: 40 },
    { day: "2026-10-06", ref: "fb", count: 40 },
    { day: "2026-10-05", ref: null, count: 20 },
    { day: "2026-10-05", ref: "gyor-padel", count: 5 },
    { day: "2026-10-04", ref: "fb", count: 999 }, // before the period
  ];
  const funnel = buildFunnel(landings, period);

  it("counts landings per source, no source last", () => {
    expect(funnel.sources).toEqual([
      { ref: "fb", landings: 80 },
      { ref: "gyor-padel", landings: 5 },
      { ref: null, landings: 20 },
    ]);
  });

  it("totals the period", () => {
    expect(funnel.total).toEqual({ ref: null, landings: 105 });
  });

  it("breaks the period down by day, including empty days", () => {
    expect(funnel.days).toEqual([
      { day: "2026-10-05", landings: 65 },
      { day: "2026-10-06", landings: 40 },
    ]);
    expect(buildFunnel([], period).days).toEqual([
      { day: "2026-10-05", landings: 0 },
      { day: "2026-10-06", landings: 0 },
    ]);
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

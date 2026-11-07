import { describe, expect, it } from "vitest";

import { formatDateTime } from "./format";
import { cityLabel, levelLabel } from "./signups-admin";

const GYOR = [{ slug: "gyor", name: "Győr" }];

describe("cityLabel", () => {
  it("names supported and other cities", () => {
    expect(cityLabel({ city: "gyor", cityOther: null }, GYOR)).toBe("Győr");
    expect(cityLabel({ city: "other", cityOther: "Szeged" }, GYOR)).toBe("Szeged (más város)");
    expect(cityLabel({ city: "other", cityOther: null }, GYOR)).toBe("Más város");
  });
});

describe("levelLabel", () => {
  it("is the level's name without its description; an unknown one as it is", () => {
    expect(levelLabel("halado")).toBe("Haladó");
    expect(levelLabel("valami")).toBe("valami");
  });
});

describe("formatDateTime", () => {
  it("formats in Budapest time, 24-hour", () => {
    expect(formatDateTime(new Date("2026-10-01T12:05:00Z"))).toBe("2026. 10. 01. 14:05");
    expect(formatDateTime(new Date("2026-12-01T23:30:00Z"))).toBe("2026. 12. 02. 00:30");
  });
});

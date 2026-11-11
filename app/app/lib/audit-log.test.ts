// Napló's filters and wording (#226), pure.
import { describe, expect, it } from "vitest";

import { actorLabel, hasLogFilters, logBounds, pageHref, parseLogFilters, refsIn, renderDetail, renderRefs } from "./audit-log";

const p = (q: string) => parseLogFilters(new URLSearchParams(q));

describe("Napló filters (#226)", () => {
  it("reads every filter from the address and ignores malformed ones", () => {
    expect(p("action=pair.dissolve&actor=u1&league=2&from=2026-11-01&to=2026-11-04&page=3")).toEqual({
      action: "pair.dissolve",
      actor: "u1",
      league: 2,
      from: "2026-11-01",
      to: "2026-11-04",
      page: 3,
      person: null,
    });
    expect(p("league=x&from=tegnap&to=2026-13-01&page=-1")).toEqual({ action: null, actor: null, league: null, from: null, to: null, page: 1, person: null });
    expect(hasLogFilters(p("page=2"))).toBe(false);
    expect(hasLogFilters(p("to=2026-11-04"))).toBe(true);
    expect(p("person=u7").person).toBe("u7");
    expect(hasLogFilters(p("person=u7"))).toBe(true);
  });

  it("turns the Budapest days into UTC bounds, the last day included", () => {
    expect(logBounds({ from: "2026-11-01", to: "2026-11-04" })).toEqual({
      since: new Date("2026-10-31T23:00:00Z"),
      before: new Date("2026-11-04T23:00:00Z"),
    });
    // Summer time: UTC+2.
    expect(logBounds({ from: "2026-07-01", to: null })).toEqual({ since: new Date("2026-06-30T22:00:00Z"), before: null });
  });

  it("links other pages with the same filters", () => {
    const params = new URLSearchParams("action=pair.create&page=2");
    expect(pageHref(params, 3)).toBe("?action=pair.create&page=3");
    expect(pageHref(params, 1)).toBe("?action=pair.create");
    expect(pageHref(new URLSearchParams(), 1)).toBe("?");
  });
});

describe("Napló wording (#226)", () => {
  it("names the system Rendszer and a deleted account Törölt játékos, never its old name", () => {
    expect(actorLabel(null, "result.auto_accept")).toBe("Rendszer");
    expect(actorLabel(null, "superadmin.grant")).toBe("Rendszer");
    // An organizer action without an actor: the account was deleted.
    expect(actorLabel(null, "pair.dissolve")).toBe("Törölt játékos");
    expect(actorLabel({ name: "Anna", deleted: true }, "pair.dissolve")).toBe("Törölt játékos");
    expect(actorLabel({ name: "Anna", deleted: false }, "pair.dissolve")).toBe("Anna");
    expect(actorLabel({ name: "", deleted: false }, "pair.dissolve")).toBe("Névtelen");
  });

  it("finds references and bare account ids", () => {
    const uuid = "0b7c4c1e-2f0a-4c8e-9d65-0a1b2c3d4e5f";
    expect(refsIn(`league:1; ${uuid} + user:abc`)).toEqual([
      { kind: "league", id: "1" },
      { kind: "user", id: "abc" },
      { kind: "user", id: uuid },
    ]);
    expect(refsIn(null)).toEqual([]);
  });

  it("shows names instead of ids, and what nothing names any more by kind and number", () => {
    const names = new Map([
      ["pair:12", "Anna – Béla"],
      ["league:1", "Padelpárbaj Győr"],
      ["user:a", "Anna"],
    ]);
    expect(renderRefs("pair:12", names)).toBe("Anna – Béla");
    expect(renderRefs("club:3", names)).toBe("Klub #3");
    expect(renderRefs("match:5", names)).toBe("Meccs #5");
    expect(renderRefs("user:gone", names)).toBe("Törölt játékos");
  });

  it("puts the stored details in Hungarian", () => {
    const names = new Map([
      ["league:1", "Győr"],
      ["user:a", "Anna"],
      ["user:b", "Béla"],
      ["user:c", "Cili"],
      ["pair:8", "Anna – Béla"],
      ["season:5", "Tél"],
    ]);
    expect(renderDetail("12 pairs", names)).toBe("12 pár");
    expect(renderDetail("3 groups, 9 matches", names)).toBe("3 csoport, 9 meccs");
    expect(renderDetail("12 signups, 30 emails, 2 reminder records", names)).toBe("12 jelentkezés, 30 levél, 2 emlékeztető-bejegyzés");
    expect(renderDetail("league:1; a + b", names)).toBe("Győr; a és b");
    expect(renderDetail("league:1; user:a + user:b", names)).toBe("Győr; Anna és Béla");
    expect(renderDetail("league:1; from pair:8; user:b -> user:c", names)).toBe("Győr; előtte: Anna – Béla; Béla → Cili");
    expect(renderDetail("league:1; account deleted", names)).toBe("Győr; fióktörlés miatt");
    expect(renderDetail("season:5 groups:3,4", names)).toBe("Tél csoport: 3,4");
    expect(renderDetail("Pécs; listed=false", names)).toBe("Pécs; nem listázva");
    expect(renderDetail("Győr; 4 signups filed", names)).toBe("Győr; 4 jelentkezés átsorolva");
    expect(renderDetail("status:withdrawn; note", names)).toBe("állapot: Visszalépett; megjegyzés");
    expect(renderDetail("cli", names)).toBe("parancssor");
    expect(renderDetail("invite:1", names)).toBe("meghívó alapján");
    expect(renderDetail("Mind; 40 recipients", names)).toBe("Mind; 40 címzett");
    expect(renderDetail("12 invites", names)).toBe("12 meghívó");
    expect(renderDetail(null, names)).toBe("");
  });
});

import { describe, expect, it, vi } from "vitest";

// Substitutes are hidden in the first season (D145); one test switches them on.
const h = vi.hoisted(() => ({ subs: false }));
vi.mock("../substitutes", async (original) => ({ ...(await original<typeof import("../substitutes")>()), substitutesEnabled: () => h.subs }));

import { adminHome, appNav, can, navLeagues, roleLabel, type Actor, type Permission } from "./permissions";

const gyor = { id: 1, slug: "gyor", city: "gyor", name: "Padelpárbaj Győr" };
const debrecen = { id: 2, slug: "debrecen", city: "debrecen", name: "Padelpárbaj Debrecen" };

const actor = (over: Partial<Actor> = {}): Actor => ({
  id: "u1",
  email: "a@example.com",
  name: "A",
  platformRole: "player",
  leagues: [],
  ...over,
});

const player = actor();
const organizer = actor({ leagues: [gyor] });
const superadmin = actor({ platformRole: "superadmin" });

const platformOnly: Permission[] = [
  { kind: "broadcasts.send" },
  { kind: "outbox.manage" },
  { kind: "traffic.view" },
  { kind: "leagues.manage" },
  { kind: "cities.manage" },
  { kind: "users.view" },
  { kind: "users.edit" },
  { kind: "users.delete" },
  { kind: "log.view" },
  { kind: "feedback.view" },
  { kind: "clubs.manage" },
];

describe("permissions", () => {
  it("lets every account into the app, nobody logged out", () => {
    expect(can(player, { kind: "app.enter" })).toBe(true);
    expect(can(null, { kind: "app.enter" })).toBe(false);
  });

  it("lets nobody in when logged out", () => {
    expect(can(null, { kind: "admin.enter" })).toBe(false);
    for (const p of platformOnly) expect(can(null, p)).toBe(false);
  });

  it("keeps a player out of the admin entirely", () => {
    expect(can(player, { kind: "admin.enter" })).toBe(false);
    for (const p of platformOnly) expect(can(player, p)).toBe(false);
    expect(can(player, { kind: "league.manage", league: "gyor" })).toBe(false);
    expect(can(player, { kind: "clubs.manage", city: "gyor" })).toBe(false);
  });

  it("lets a Szervező into the admin, their own league and their city's clubs", () => {
    expect(can(organizer, { kind: "admin.enter" })).toBe(true);
    expect(can(organizer, { kind: "league.manage", league: "gyor" })).toBe(true);
    expect(can(organizer, { kind: "clubs.manage", city: "gyor" })).toBe(true);
  });

  it("keeps a Szervező out of other leagues and cities", () => {
    expect(can(organizer, { kind: "league.manage", league: "debrecen" })).toBe(false);
    expect(can(organizer, { kind: "clubs.manage", city: "debrecen" })).toBe(false);
  });

  it("keeps a Szervező off the Admin pages", () => {
    for (const p of platformOnly) expect(can(organizer, p)).toBe(false);
  });

  it("lets a Szervező of two leagues manage both", () => {
    const both = actor({ leagues: [gyor, debrecen] });
    expect(can(both, { kind: "league.manage", league: "gyor" })).toBe(true);
    expect(can(both, { kind: "league.manage", league: "debrecen" })).toBe(true);
    expect(can(both, { kind: "league.manage", league: "szeged" })).toBe(false);
  });

  it("lets the Admin do everything, also in leagues they don't organize", () => {
    expect(can(superadmin, { kind: "admin.enter" })).toBe(true);
    for (const p of platformOnly) expect(can(superadmin, p)).toBe(true);
    expect(can(superadmin, { kind: "league.manage", league: "debrecen" })).toBe(true);
    expect(can(superadmin, { kind: "clubs.manage", city: "szeged" })).toBe(true);
  });
});

describe("role labels", () => {
  it("names the highest role", () => {
    expect(roleLabel(player)).toBe("Játékos");
    expect(roleLabel(organizer)).toBe("Szervező");
    expect(roleLabel(actor({ platformRole: "superadmin", leagues: [gyor] }))).toBe("Admin");
  });
});

describe("sidebar", () => {
  it("shows the Admin the league section and every Admin page", () => {
    const nav = appNav(superadmin, [gyor, debrecen]);
    expect(nav.map((s) => s.role)).toEqual([undefined, "Szervező", "Admin"]);
    expect(nav.map((s) => s.label)).toEqual(["", "Padelpárbaj Győr", "Platform"]);
    expect(nav[0].items.map((i) => i.to)).toEqual(["/home", "/notifications"]);
    expect(nav[1].items.map((i) => i.to)).toEqual([
      "/admin/leagues/gyor",
      "/admin/leagues/gyor/seasons",
      "/admin/leagues/gyor/matches",
      "/admin/leagues/gyor/players",
      "/admin/leagues/gyor/pairs",
      "/admin/leagues/gyor/reminders",
      "/admin/leagues/gyor/clubs",
      "/admin/leagues/gyor/disputes",
      // No "Helyettesek" in the first season (D145).
    ]);
    expect(nav[2].items.map((i) => i.to)).toEqual([
      "/admin/leagues",
      "/admin/cities",
      "/admin/users",
      "/admin/broadcasts",
      "/admin/outbox",
      "/admin/traffic",
      "/admin/log",
      "/admin/feedback",
    ]);
    expect(adminHome(superadmin)).toBe("/admin/leagues");
  });

  it("has two people pages, each with a one-line description (#301)", () => {
    const nav = appNav(superadmin, [gyor]);
    const people = nav.flatMap((s) => s.items).filter((i) => i.icon === "players" || i.icon === "users");
    expect(people.map((i) => i.label)).toEqual(["Játékosok", "Felhasználók"]);
    for (const i of people) expect(i.hint?.trim()).toBeTruthy();
    expect(nav.flatMap((s) => s.items).some((i) => i.to.endsWith("/solos"))).toBe(false);
  });

  it("lets only the Admin edit a player's profile (#301, D156)", () => {
    expect(can(superadmin, { kind: "users.edit" })).toBe(true);
    expect(can(organizer, { kind: "users.edit" })).toBe(false);
    expect(can(player, { kind: "users.edit" })).toBe(false);
  });

  it("follows the league in the URL", () => {
    const nav = appNav(superadmin, [gyor, debrecen], "debrecen");
    expect(nav[1].label).toBe("Padelpárbaj Debrecen");
    expect(nav[1].items.find((i) => i.label === "Klubok")?.to).toBe("/admin/leagues/debrecen/clubs");
  });

  it("offers the Admin every league, a Szervező only their own", () => {
    expect(navLeagues(superadmin, [gyor, debrecen])).toEqual([gyor, debrecen]);
    expect(navLeagues(organizer, [gyor, debrecen])).toEqual([gyor]);
  });

  it("shows a Szervező their league and no Admin section", () => {
    const nav = appNav(organizer, navLeagues(organizer, [gyor, debrecen]));
    expect(nav.map((s) => s.label)).toEqual(["", "Padelpárbaj Győr"]);
    expect(nav[1].items.map((i) => i.label)).toEqual(["Áttekintés", "Szezonok", "Meccsek", "Játékosok", "Párok", "Emlékeztetők", "Klubok", "Viták"]);
    expect(adminHome(organizer)).toBe("/admin/leagues/gyor");
  });

  it("offers Helyettesek only while substitutes are on (D145)", () => {
    h.subs = true;
    try {
      const items = appNav(organizer, [gyor])[1]!.items;
      expect(items.at(-1)).toMatchObject({ label: "Helyettesek", to: "/admin/leagues/gyor/substitutes" });
    } finally {
      h.subs = false;
    }
  });

  it("Viták (#29): the league's Szervező and the Admin, not another league's Szervező or a player", () => {
    const disputes = { kind: "league.manage", league: "gyor" } as const;
    expect(can(organizer, disputes)).toBe(true);
    expect(can(superadmin, disputes)).toBe(true);
    expect(can({ ...organizer, leagues: [debrecen] }, disputes)).toBe(false);
    expect(can({ ...organizer, leagues: [] }, disputes)).toBe(false);
  });

  it("ignores a URL league the Szervező doesn't organize", () => {
    const nav = appNav(organizer, navLeagues(organizer, [gyor, debrecen]), "debrecen");
    expect(nav[1].label).toBe("Padelpárbaj Győr");
  });

  it("shows a player only the app home and notifications: no Párom, the pair is in Profil (D141)", () => {
    expect(appNav(player, navLeagues(player, [gyor])).map((s) => s.items.map((i) => i.to))).toEqual([["/home", "/notifications"]]);
    expect(adminHome(player)).toBeNull();
  });
});

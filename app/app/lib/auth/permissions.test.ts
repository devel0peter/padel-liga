import { describe, expect, it } from "vitest";

import { adminHome, adminNav, can, roleLabel, type Actor, type Permission } from "./permissions";

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
  { kind: "signups.manage" },
  { kind: "broadcasts.send" },
  { kind: "traffic.view" },
  { kind: "leagues.manage" },
  { kind: "users.view" },
  { kind: "clubs.manage" },
];

describe("permissions", () => {
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

  it("keeps a Szervező off the Főadmin pages", () => {
    for (const p of platformOnly) expect(can(organizer, p)).toBe(false);
  });

  it("lets a Szervező of two leagues manage both", () => {
    const both = actor({ leagues: [gyor, debrecen] });
    expect(can(both, { kind: "league.manage", league: "gyor" })).toBe(true);
    expect(can(both, { kind: "league.manage", league: "debrecen" })).toBe(true);
    expect(can(both, { kind: "league.manage", league: "szeged" })).toBe(false);
  });

  it("lets the Főadmin do everything, also in leagues they don't organize", () => {
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
    expect(roleLabel(actor({ platformRole: "superadmin", leagues: [gyor] }))).toBe("Főadmin");
  });
});

describe("sidebar", () => {
  it("shows the Főadmin everything", () => {
    const nav = adminNav(superadmin);
    expect(nav.map((s) => s.label)).toEqual(["Főadmin"]);
    expect(nav[0].items.map((i) => i.to)).toEqual([
      "/admin/signups",
      "/admin/broadcasts",
      "/admin/clubs",
      "/admin/traffic",
    ]);
    expect(adminHome(superadmin)).toBe("/admin/signups");
  });

  it("hides the Főadmin section from a Szervező", () => {
    expect(adminNav(organizer)).toEqual([]);
    expect(adminHome(organizer)).toBeNull();
  });

  it("shows a player nothing", () => {
    expect(adminNav(player)).toEqual([]);
  });
});

// Who may do what (docs/admin-plan.md, spec section 2). Pure: the guard in
// admin.server.ts loads the actor and asks can(); every rule is unit tested.

export type PlatformRole = "player" | "superadmin";

export type LeagueRef = { id: number; slug: string; city: string; name: string };

// The logged-in account with its roles. `leagues`: where they are Szervező.
export type Actor = {
  id: string;
  email: string;
  name: string;
  platformRole: PlatformRole;
  leagues: LeagueRef[];
};

export type Permission =
  // See the admin area at all.
  | { kind: "admin.enter" }
  // Főadmin only: the interest list (and its CSV), broadcasts, traffic,
  // leagues and Szervező appointments, the user list.
  | { kind: "signups.manage" }
  | { kind: "broadcasts.send" }
  | { kind: "traffic.view" }
  | { kind: "leagues.manage" }
  | { kind: "users.view" }
  // A city's clubs (venues): its Szervezők. Without a city: every city's.
  | { kind: "clubs.manage"; city?: string }
  // One league's organizer pages.
  | { kind: "league.manage"; league: string };

export function can(actor: Actor | null, permission: Permission): boolean {
  if (!actor) return false;
  if (actor.platformRole === "superadmin") return true;
  switch (permission.kind) {
    case "admin.enter":
      return actor.leagues.length > 0;
    case "clubs.manage":
      return permission.city !== undefined && actor.leagues.some((l) => l.city === permission.city);
    case "league.manage":
      return actor.leagues.some((l) => l.slug === permission.league);
    default:
      return false;
  }
}

export type RoleLabel = "Főadmin" | "Szervező" | "Játékos";

export function roleLabel(actor: Pick<Actor, "platformRole" | "leagues">): RoleLabel {
  if (actor.platformRole === "superadmin") return "Főadmin";
  return actor.leagues.length > 0 ? "Szervező" : "Játékos";
}

// --- Sidebar ----------------------------------------------------------------

export type NavIcon = "signups" | "broadcasts" | "clubs" | "traffic";
export type NavItem = { label: string; to: string; icon: NavIcon; permission: Permission };
export type NavSection = { label: string; items: NavItem[] };

const PLATFORM_ITEMS: NavItem[] = [
  { label: "Jelentkezők", to: "/admin/signups", icon: "signups", permission: { kind: "signups.manage" } },
  { label: "Körlevelek", to: "/admin/broadcasts", icon: "broadcasts", permission: { kind: "broadcasts.send" } },
  { label: "Klubok", to: "/admin/clubs", icon: "clubs", permission: { kind: "clubs.manage" } },
  { label: "Forgalom", to: "/admin/traffic", icon: "traffic", permission: { kind: "traffic.view" } },
];

// Only what the actor may open; a section with nothing in it isn't shown.
export function adminNav(actor: Actor): NavSection[] {
  const sections: NavSection[] = [{ label: "Főadmin", items: PLATFORM_ITEMS }];
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => can(actor, i.permission)) }))
    .filter((s) => s.items.length > 0);
}

// Where /admin sends you: the first page you may open.
export function adminHome(actor: Actor): string | null {
  return adminNav(actor)[0]?.items[0]?.to ?? null;
}

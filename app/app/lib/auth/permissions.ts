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
  // Any logged-in account: the app home, the profile.
  | { kind: "app.enter" }
  // See the admin area at all.
  | { kind: "admin.enter" }
  // Admin (superadmin) only: the interest list (and its CSV), broadcasts, traffic,
  // leagues and Szervező appointments, the user list.
  | { kind: "signups.manage" }
  | { kind: "broadcasts.send" }
  | { kind: "traffic.view" }
  | { kind: "leagues.manage" }
  | { kind: "cities.manage" }
  | { kind: "users.view" }
  // A city's clubs (venues): its Szervezők. Without a city: every city's.
  | { kind: "clubs.manage"; city?: string }
  // One league's organizer pages.
  | { kind: "league.manage"; league: string };

export function can(actor: Actor | null, permission: Permission): boolean {
  if (!actor) return false;
  if (actor.platformRole === "superadmin") return true;
  switch (permission.kind) {
    case "app.enter":
      return true;
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

export type RoleLabel = "Admin" | "Szervező" | "Játékos";

export function roleLabel(actor: Pick<Actor, "platformRole" | "leagues">): RoleLabel {
  if (actor.platformRole === "superadmin") return "Admin";
  return actor.leagues.length > 0 ? "Szervező" : "Játékos";
}

// --- Sidebar ----------------------------------------------------------------

export type NavIcon = "home" | "overview" | "signups" | "broadcasts" | "clubs" | "traffic" | "leagues" | "cities" | "users";
export type NavItem = { label: string; to: string; icon: NavIcon; permission: Permission };
// `role`: who the section is for, shown as a tag next to its title, so a
// Szervező or the Admin sees which pages players don't have.
export type NavSection = { label: string; role?: "Szervező" | "Admin"; items: NavItem[] };

const PLATFORM_ITEMS: NavItem[] = [
  { label: "Ligák", to: "/admin/leagues", icon: "leagues", permission: { kind: "leagues.manage" } },
  { label: "Városok", to: "/admin/cities", icon: "cities", permission: { kind: "cities.manage" } },
  { label: "Felhasználók", to: "/admin/users", icon: "users", permission: { kind: "users.view" } },
  { label: "Jelentkezők", to: "/admin/signups", icon: "signups", permission: { kind: "signups.manage" } },
  { label: "Körlevelek", to: "/admin/broadcasts", icon: "broadcasts", permission: { kind: "broadcasts.send" } },
  { label: "Forgalom", to: "/admin/traffic", icon: "traffic", permission: { kind: "traffic.view" } },
];

function leagueItems(league: LeagueRef): NavItem[] {
  const base = `/admin/leagues/${league.slug}`;
  return [
    { label: "Áttekintés", to: base, icon: "overview", permission: { kind: "league.manage", league: league.slug } },
    { label: "Klubok", to: `${base}/clubs`, icon: "clubs", permission: { kind: "clubs.manage", city: league.city } },
  ];
}

// The leagues the sidebar offers: the Admin sees every league, a Szervező
// their own.
export function navLeagues(actor: Actor, allLeagues: LeagueRef[]): LeagueRef[] {
  return actor.platformRole === "superadmin" ? allLeagues : actor.leagues;
}

// The league section shows the current league (from the URL, else the first);
// the switcher above it lists the others. Only what the actor may open; a
// section with nothing in it isn't shown.
export function appNav(actor: Actor, leagues: LeagueRef[] = navLeagues(actor, []), current?: string | null): NavSection[] {
  const league = leagues.find((l) => l.slug === current) ?? leagues[0];
  // First, unlabelled: the app home, for everyone.
  const sections: NavSection[] = [
    { label: "", items: [{ label: "Kezdőlap", to: "/home", icon: "home", permission: { kind: "app.enter" } }] },
  ];
  if (league) sections.push({ label: league.name, role: "Szervező", items: leagueItems(league) });
  sections.push({ label: "Platform", role: "Admin", items: PLATFORM_ITEMS });
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => can(actor, i.permission)) }))
    .filter((s) => s.items.length > 0);
}

// Where /admin sends you: the Admin to the signups, a Szervező to their
// (first) league. Null: nothing to open yet.
export function adminHome(actor: Actor): string | null {
  if (actor.platformRole === "superadmin") return "/admin/signups";
  const league = actor.leagues[0];
  return league ? `/admin/leagues/${league.slug}` : null;
}

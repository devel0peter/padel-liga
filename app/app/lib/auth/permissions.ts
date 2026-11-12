// Who may do what (docs/admin-plan.md, spec section 2). Pure: the guard in
// admin.server.ts loads the actor and asks can(); every rule is unit tested.

import { substitutesEnabled } from "../substitutes";

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
  // Admin (superadmin) only: broadcasts, the outbox log, traffic, leagues and
  // Szervező appointments, the user list.
  | { kind: "broadcasts.send" }
  | { kind: "outbox.manage" }
  | { kind: "traffic.view" }
  | { kind: "leagues.manage" }
  | { kind: "cities.manage" }
  | { kind: "users.view" }
  // Change a player's name, phone, level and sex on their profile (#301,
  // D156). Admin only: no Szervező edits someone else's account.
  | { kind: "users.edit" }
  // Napló, the audit log (#226): read-only.
  | { kind: "log.view" }
  // Visszajelzések (#241, spec 19): read feedback and mark it done.
  | { kind: "feedback.view" }
  // Delete or anonymize an account (#152). Which accounts: account-deletion.ts.
  | { kind: "users.delete" }
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

export type NavIcon = "home" | "notifications" | "rankings" | "overview" | "seasons" | "matches" | "pairs" | "players" | "disputes" | "substitutes" | "reminders" | "broadcasts" | "outbox" | "clubs" | "traffic" | "leagues" | "cities" | "users" | "log" | "feedback";
// `hint`: one short line under the label on what the page lists (#301: the
// people pages say what each is for).
export type NavItem = { label: string; to: string; icon: NavIcon; permission: Permission; hint?: string };
// `role`: who the section is for, shown as a tag next to its title, so a
// Szervező or the Admin sees which pages players don't have.
export type NavSection = { label: string; role?: "Szervező" | "Admin"; items: NavItem[] };

const PLATFORM_ITEMS: NavItem[] = [
  { label: "Ligák", to: "/admin/leagues", icon: "leagues", permission: { kind: "leagues.manage" } },
  { label: "Városok", to: "/admin/cities", icon: "cities", permission: { kind: "cities.manage" } },
  {
    label: "Felhasználók",
    to: "/admin/users",
    icon: "users",
    permission: { kind: "users.view" },
    hint: "Minden fiók, adatlappal",
  },
  { label: "Körlevelek", to: "/admin/broadcasts", icon: "broadcasts", permission: { kind: "broadcasts.send" } },
  { label: "Kimenő levelek", to: "/admin/outbox", icon: "outbox", permission: { kind: "outbox.manage" } },
  { label: "Forgalom", to: "/admin/traffic", icon: "traffic", permission: { kind: "traffic.view" } },
  { label: "Napló", to: "/admin/log", icon: "log", permission: { kind: "log.view" } },
  { label: "Visszajelzések", to: "/admin/feedback", icon: "feedback", permission: { kind: "feedback.view" } },
];

function leagueItems(league: LeagueRef): NavItem[] {
  const base = `/admin/leagues/${league.slug}`;
  return [
    { label: "Áttekintés", to: base, icon: "overview", permission: { kind: "league.manage", league: league.slug } },
    { label: "Szezonok", to: `${base}/seasons`, icon: "seasons", permission: { kind: "league.manage", league: league.slug } },
    { label: "Meccsek", to: `${base}/matches`, icon: "matches", permission: { kind: "league.manage", league: league.slug } },
    // The league's people (#301, D155): every registered player once, with
    // pair, "Párt keresek" and entry; Párok lists the pairs.
    {
      label: "Játékosok",
      to: `${base}/players`,
      icon: "players",
      permission: { kind: "league.manage", league: league.slug },
      hint: "Mindenki egyszer, párral",
    },
    {
      label: "Párok",
      to: `${base}/pairs`,
      icon: "pairs",
      permission: { kind: "league.manage", league: league.slug },
      hint: "A párok és nevezésük",
    },
    { label: "Emlékeztetők", to: `${base}/reminders`, icon: "reminders", permission: { kind: "league.manage", league: league.slug } },
    { label: "Klubok", to: `${base}/clubs`, icon: "clubs", permission: { kind: "clubs.manage", city: league.city } },
    // Disputed results and decisions on any match (#29).
    { label: "Viták", to: `${base}/disputes`, icon: "disputes", permission: { kind: "league.manage", league: league.slug } },
    // Substitute requests to approve (#37, D109); hidden in the first season
    // (D145), the page stays reachable by URL.
    ...(substitutesEnabled()
      ? ([{ label: "Helyettesek", to: `${base}/substitutes`, icon: "substitutes", permission: { kind: "league.manage", league: league.slug } }] satisfies NavItem[])
      : []),
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
  // First, unlabelled: the app home and the notifications, for everyone (the
  // pair is a section of Profil, D141).
  const sections: NavSection[] = [
    {
      label: "",
      items: [
        { label: "Kezdőlap", to: "/home", icon: "home", permission: { kind: "app.enter" } },
        { label: "Értesítések", to: "/notifications", icon: "notifications", permission: { kind: "app.enter" } },
      ],
    },
  ];
  if (league) sections.push({ label: league.name, role: "Szervező", items: leagueItems(league) });
  sections.push({ label: "Platform", role: "Admin", items: PLATFORM_ITEMS });
  return sections
    .map((s) => ({ ...s, items: s.items.filter((i) => can(actor, i.permission)) }))
    .filter((s) => s.items.length > 0);
}

// Where /admin sends you: the Admin to the leagues, a Szervező to their
// (first) league. Null: nothing to open yet.
export function adminHome(actor: Actor): string | null {
  if (actor.platformRole === "superadmin") return "/admin/leagues";
  const league = actor.leagues[0];
  return league ? `/admin/leagues/${league.slug}` : null;
}

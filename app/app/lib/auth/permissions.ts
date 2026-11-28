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

export type NavIcon =
  | "home"
  | "myLeagues"
  | "notifications"
  | "rankings"
  | "profile"
  | "overview"
  | "seasons"
  | "matches"
  | "pairs"
  | "players"
  | "disputes"
  | "reminders"
  | "broadcasts"
  | "outbox"
  | "clubs"
  | "traffic"
  | "leagues"
  | "cities"
  | "users"
  | "log"
  | "feedback"
  | "settings"
  | "help";
// `hint`: one short line under the label on what the page lists (#301: the
// people pages say what each is for).
export type NavItem = { label: string; to: string; icon: NavIcon; permission: Permission; hint?: string; badge?: number };
// `role`: who the section is for, shown as a tag next to its title, so a
// Szervező or the Admin sees which pages players don't have.
export type NavSection = { label: string; role?: "Szervező" | "Admin"; items: NavItem[] };

export type LeagueNavMeta = {
  radVarCount: number;
  decisionsCount: number;
  runningRound: { seasonId: number; phase: number } | null;
};

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

function leagueItems(league: LeagueRef, meta?: LeagueNavMeta | null): NavItem[] {
  const base = `/admin/leagues/${league.slug}`;
  const manage: Permission = { kind: "league.manage", league: league.slug };
  return [
    { label: "Áttekintés", to: base, icon: "overview", permission: manage, badge: meta?.radVarCount || undefined },
    { label: "Döntések", to: `${base}/disputes`, icon: "disputes", permission: manage, badge: meta?.decisionsCount || undefined },
    ...(meta?.runningRound
      ? [
          {
            label: `${meta.runningRound.phase}. kör`,
            to: `${base}/seasons/${meta.runningRound.seasonId}/rounds/${meta.runningRound.phase}`,
            icon: "matches" as const,
            permission: manage,
          },
        ]
      : []),
    { label: "Játékosok", to: `${base}/players`, icon: "players", permission: manage },
    { label: "Szezonok", to: `${base}/seasons`, icon: "seasons", permission: manage },
    { label: "Levelek", to: `${base}/mail`, icon: "broadcasts", permission: manage },
    { label: "Beállítások", to: `${base}/settings`, icon: "settings", permission: manage },
    { label: "Súgó", to: `${base}/help`, icon: "help", permission: manage },
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
export function appNav(
  actor: Actor,
  leagues: LeagueRef[] = navLeagues(actor, []),
  current?: string | null,
  leagueMeta?: LeagueNavMeta | null,
): NavSection[] {
  const league = leagues.find((l) => l.slug === current) ?? leagues[0];
  // First, unlabelled: the app home, Ligáim (#394) and the notifications, for
  // everyone (the pair is a section of Profil, D141).
  const sections: NavSection[] = [
    {
      label: "",
      items: [
        { label: "Kezdőlap", to: "/home", icon: "home", permission: { kind: "app.enter" } },
        { label: "Ligáim", to: "/leagues", icon: "myLeagues", permission: { kind: "app.enter" } },
        { label: "Értesítések", to: "/notifications", icon: "notifications", permission: { kind: "app.enter" } },
      ],
    },
  ];
  if (league) sections.push({ label: league.name, role: "Szervező", items: leagueItems(league, leagueMeta) });
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

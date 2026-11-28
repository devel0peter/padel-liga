import {
  BarChart3,
  Bell,
  BellRing,
  Building2,
  CalendarDays,
  ChartNoAxesColumn,
  Check,
  ChevronsUpDown,
  HeartHandshake,
  HelpCircle,
  House,
  LayoutDashboard,
  Mail,
  MapPin,
  MessageSquareText,
  Scale,
  ScrollText,
  Send,
  Settings,
  Shield,
  Swords,
  Trophy,
  User,
  UserCog,
  UsersRound,
} from "lucide-react";
import { Form, Link, NavLink, Outlet, useLocation } from "react-router";


import type { Route } from "./+types/app";
import { teamHue } from "~/components/blocks/team-badge";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  useSidebar,
} from "~/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { TooltipProvider } from "~/components/ui/tooltip";
import { getActor } from "~/lib/auth/admin.server";
import { appNav, navLeagues, roleLabel, type LeagueRef, type NavIcon, type NavItem, type NavSection } from "~/lib/auth/permissions";
import { initials } from "~/lib/auth/rules";
import { requireUser } from "~/lib/auth/session.server";
import { leagueFromPath, switchLeaguePath } from "~/lib/leagues";
import { listLeagues, playerLeagueSlug } from "~/lib/leagues.server";
import { unreadCount } from "~/lib/notifications.server";
import { organizerHomeSummary, organizerSidebarMeta } from "~/lib/organizer-decisions.server";
import { shellTeam, type ShellTeam } from "~/lib/shell.server";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// The app shell (D181, docs/ui/mockups): the sidebar on wider screens, the
// bottom bar on phones, for every page of a logged-in user. The sidebar: the
// logo, the user chip with the team, the player's pages, then the sections
// the user's roles give, then Szabályzat, Visszajelzés, Kilépés. It doesn't
// collapse; on a phone it is the slide-in panel AppPage's menu button opens.

// Logged in, with name and privacy consent, before any page in the shell.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }) => {
    await requireUser(request);
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  const [leagues, unread, tableHref, team] = await Promise.all([
    navLeagues(actor, actor.platformRole === "superadmin" ? await listLeagues() : []),
    // The badge on Értesítések, in the sidebar and the phone's bottom bar (D133).
    unreadCount(user.id),
    // The league whose table "Tabella" opens (D133, D134).
    playerLeagueSlug(user.id).then((slug) => (slug ? `/league/${slug}` : null)),
    // The user chip's second line (D181).
    shellTeam(user.id),
  ]);
  const urlSlug = leagueFromPath(new URL(request.url).pathname);
  const activeLeague = leagues.find((l) => l.slug === urlSlug) ?? leagues[0] ?? null;
  const [leagueMeta, orgHome] = await Promise.all([
    activeLeague ? organizerSidebarMeta(activeLeague.id, activeLeague.slug) : Promise.resolve(null),
    leagues.length > 0 ? organizerHomeSummary(actor) : Promise.resolve({ total: 0, leagues: [] }),
  ]);
  return {
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    initials: initials(user.name, user.email),
    role: roleLabel(actor),
    // The nav is built in the component from the URL (current league), with
    // the same pure function; the actor is the user's own data.
    actor,
    leagues,
    leagueMeta,
    organizerWaitingCount: orgHome.total,
    unread,
    tableHref,
    team,
  };
}

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  home: House,
  myLeagues: Shield,
  rankings: ChartNoAxesColumn,
  notifications: Bell,
  overview: LayoutDashboard,
  seasons: CalendarDays,
  matches: Swords,
  pairs: HeartHandshake,
  players: UsersRound,
  disputes: Scale,
  reminders: BellRing,
  broadcasts: Mail,
  outbox: Send,
  clubs: MapPin,
  traffic: BarChart3,
  leagues: Trophy,
  cities: Building2,
  users: UserCog,
  log: ScrollText,
  feedback: MessageSquareText,
  profile: User,
  settings: Settings,
  help: HelpCircle,
};

const isCurrent = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

// The one nav item to highlight: the longest path the URL starts with, so
// /admin/leagues/gyor/clubs marks Klubok, not also Áttekintés.
function activeItem(nav: NavSection[], pathname: string): string | null {
  let best: string | null = null;
  for (const s of nav)
    for (const i of s.items) if (isCurrent(pathname, i.to) && (!best || i.to.length > best.length)) best = i.to;
  return best;
}

// "99+": the unread count on Értesítések, in amber (D181).
const unreadLabel = (unread: number) => (unread > 99 ? "99+" : String(unread));

// The user's own circle: their colour in the pair's TeamBadge, else neutral.
function avatarColor(team: ShellTeam | null): React.CSSProperties | undefined {
  if (!team) return undefined;
  return { backgroundColor: `var(--team-${teamHue(team.pairId)}${team.first ? "" : "-light"})` };
}

// A section's title with its role tag (Szervező / Admin) on the right.
function NavSectionLabel({ label, role }: { label: string; role?: string }) {
  return (
    <>
      <span className="truncate">{label}</span>
      {role && (
        <span className="ml-auto shrink-0 rounded-full bg-surface-3 px-1.5 py-px text-[10px] font-semibold tracking-wide text-soft-foreground uppercase">
          {role}
        </span>
      )}
    </>
  );
}

function LeagueSwitcher({ leagues, current, role }: { leagues: LeagueRef[]; current: string; role?: string }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarGroupLabel asChild>
          <button type="button" className="h-7 w-full gap-1.5 hover:bg-sidebar-accent">
            <NavSectionLabel label={current} role={role} />
            <ChevronsUpDown className="shrink-0" />
          </button>
        </SidebarGroupLabel>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Liga váltása</DropdownMenuLabel>
        {leagues.map((l) => (
          <DropdownMenuItem key={l.slug} asChild>
            <Link to={switchLeaguePath(pathname, l.slug)} onClick={() => setOpenMobile(false)} className="no-underline">
              <span className="flex-1">{l.name}</span>
              {l.name === current && <Check />}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// The logo with the ball dot, as on the mockups.
function ShellLogo() {
  return (
    <Link to="/home" aria-label={`${SITE_NAME}: kezdőlap`} className="flex w-fit items-center gap-2 px-2.5 text-[19px] leading-none no-underline">
      <span aria-hidden="true" className="size-3 shrink-0 rounded-full bg-ball" />
      {/* One word, "Padel" heavy, as site.tsx's Wordmark, at the body width. */}
      <span>
        <span className="font-extrabold">Padel</span>
        <span className="font-medium">párbaj</span>
      </span>
    </Link>
  );
}

type ChipProps = { name: string; email: string; imageUrl: string | null; initials: string; role: string; team: ShellTeam | null };

// Who is logged in: name, and the team with its division (or the role).
function UserChip({ name, email, imageUrl, initials, role, team }: ChipProps) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-surface p-2">
      <Avatar className="size-9">
        {imageUrl && <AvatarImage src={imageUrl} alt="" referrerPolicy="no-referrer" />}
        <AvatarFallback className="bg-surface-3 text-[13px] font-bold text-foreground" style={avatarColor(team)}>
          {initials}
        </AvatarFallback>
      </Avatar>
      <span className="grid min-w-0 flex-1 gap-px leading-tight">
        <span className="truncate text-sm font-bold text-foreground">{name || email}</span>
        <span className="line-clamp-2 text-xs text-muted-foreground">
          {team ? [team.name, team.division].filter(Boolean).join(" · ") : role}
        </span>
      </span>
    </div>
  );
}

// Nav items: the player's own pages as on the mockups (40 px, 20 px icons);
// the organizer's and the Admin's sections compact (30 px, 16 px icons), so
// they fit at 1280x800. When they still don't (the Admin's, a short window),
// the nav scrolls with a visible scrollbar and edge shadows (app.css
// .shell-nav). The active one in ball yellow on a tint (--nav-active).
const NAV_ROW = {
  player: "h-10 gap-3 rounded-[10px] px-2.5 text-[15px] data-active:font-bold [&_svg]:size-5",
  compact: "h-[30px] gap-2.5 rounded-lg px-2.5 text-sm data-active:font-bold [&_svg]:size-4",
};

function NavMenu({ nav, leagues, unread }: { nav: NavSection[]; leagues: LeagueRef[]; unread: number }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const active = activeItem(nav, pathname);
  return nav.map((section, i) => (
    <SidebarGroup key={section.label} className="px-0 py-0 not-first:pt-3">
      {/* The league section gets a switcher when there are more leagues. */}
      {leagues.length > 1 && leagues.some((l) => l.name === section.label) ? (
        <LeagueSwitcher leagues={leagues} current={section.label} role={section.role} />
      ) : (
        section.label && (
          <SidebarGroupLabel className="h-7 gap-1.5 px-2.5">
            <NavSectionLabel label={section.label} role={section.role} />
          </SidebarGroupLabel>
        )
      )}
      <SidebarMenu className="gap-0.5">
        {section.items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton
                asChild
                isActive={item.to === active}
                size={item.hint ? "lg" : "default"}
                className={cn(i === 0 ? NAV_ROW.player : NAV_ROW.compact, item.hint && "h-10")}
              >
                <NavLink to={item.to} onClick={() => setOpenMobile(false)} className="no-underline">
                  <Icon />
                  {item.hint ? (
                    // The people pages say in one line what they list (#301).
                    <span className="grid min-w-0 leading-tight">
                      <span className="truncate">{item.label}</span>
                      <span className="truncate text-xs font-normal text-muted-foreground">{item.hint}</span>
                    </span>
                  ) : (
                    <span>{item.label}</span>
                  )}
                </NavLink>
              </SidebarMenuButton>
              {(item.to === "/notifications" ? unread : item.badge ?? 0) > 0 && (
                <SidebarMenuBadge className="right-2.5 rounded-full bg-warning px-1.5 font-extrabold text-ball-foreground peer-hover/menu-button:text-ball-foreground peer-data-active/menu-button:text-ball-foreground peer-data-[size=default]/menu-button:top-2.5">
                  {unreadLabel(item.to === "/notifications" ? unread : item.badge!)}
                </SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  ));
}

// The quiet links at the foot of the sidebar.
const footLink = "h-7 px-2.5 text-[13px] text-muted-foreground hover:text-foreground";

// Phones (D133, D174, docs/player-ui.md N1): the player's own pages one tap
// away at the bottom; the sidebar stays for the organizer's and the Admin's
// sections.
function TabBar({
  tableHref,
  unread,
  initials,
  imageUrl,
  team,
}: {
  tableHref: string | null;
  unread: number;
  initials: string;
  imageUrl: string | null;
  team: ShellTeam | null;
}) {
  const { pathname } = useLocation();
  const tabs = [
    { to: "/home", label: "Kezdőlap", icon: House },
    ...(tableHref ? [{ to: tableHref, label: "Tabella", icon: Trophy }] : []),
    { to: "/leagues", label: "Ligáim", icon: Shield },
    { to: "/notifications", label: "Értesítések", icon: Bell },
  ];
  const item = (active: boolean) =>
    cn(
      "relative flex min-h-11 min-w-0 flex-col items-center justify-start gap-1 px-0.5 text-[11px] no-underline",
      active ? "font-bold text-ball" : "text-muted-foreground",
    );
  const profileActive = isCurrent(pathname, "/profile");
  return (
    <nav
      aria-label="Fő menü"
      className="fixed inset-x-0 bottom-0 z-40 grid auto-cols-fr grid-flow-col border-t border-white/8 bg-sidebar px-1 pt-2 pb-[max(12px,env(safe-area-inset-bottom))] md:hidden"
    >
      {tabs.map(({ to, label, icon: Icon }) => {
        const active = isCurrent(pathname, to);
        return (
          <Link key={to} to={to} aria-current={active ? "page" : undefined} className={item(active)}>
            <Icon aria-hidden className="size-[22px]" />
            <span className="max-w-full truncate">{label}</span>
            {to === "/notifications" && unread > 0 && (
              <span className="absolute -top-1 left-1/2 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] leading-none font-extrabold text-ball-foreground">
                {unreadLabel(unread)}
              </span>
            )}
          </Link>
        );
      })}
      <Link to="/profile" aria-current={profileActive ? "page" : undefined} className={item(profileActive)}>
        <Avatar className="size-[22px]">
          {imageUrl && <AvatarImage src={imageUrl} alt="" referrerPolicy="no-referrer" />}
          <AvatarFallback
            className={cn("text-[9px] font-bold", profileActive ? "bg-ball text-ball-foreground" : "bg-surface-3 text-foreground")}
            style={profileActive ? undefined : avatarColor(team)}
          >
            {initials}
          </AvatarFallback>
        </Avatar>
        <span className="max-w-full truncate">Profil</span>
      </Link>
    </nav>
  );
}

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const { actor, leagues, leagueMeta, unread, tableHref, ...profile } = loaderData;
  const { pathname, search } = useLocation();
  const base = appNav(actor, leagues, leagueFromPath(pathname), leagueMeta);
  // The player's own pages first, as on the mockups: Kezdőlap, Tabella and
  // Ranglista (D133, D134, D137), Ligáim, Értesítések, then Profil (D141).
  const nav = base.map((section, i): NavSection => {
    if (i !== 0) return section;
    const [home, ...rest] = section.items;
    const permission = home!.permission;
    const table: NavItem[] = tableHref
      ? [
          { label: "Tabella", to: tableHref, icon: "leagues", permission },
          { label: "Ranglista", to: `${tableHref}/rankings`, icon: "rankings", permission },
        ]
      : [];
    const profileItem: NavItem = { label: "Profil", to: "/profile", icon: "profile", permission };
    return { ...section, items: [home!, ...table, ...rest, profileItem] };
  });
  return (
    <TooltipProvider>
      {/* Always open on wider screens: no collapse on the mockups. */}
      <SidebarProvider open onOpenChange={() => {}} style={{ "--sidebar-width": "15.5rem" } as React.CSSProperties}>
        <Sidebar className="border-sidebar-border">
          <SidebarHeader className="gap-3.5 px-3 pt-4 pb-3.5">
            <ShellLogo />
            <UserChip {...profile} />
          </SidebarHeader>
          <SidebarContent className="shell-nav px-3 pb-2">
            <NavMenu nav={nav} leagues={leagues} unread={unread} />
          </SidebarContent>
          <SidebarFooter className="gap-0.5 px-3 pt-2 pb-3">
            <SidebarMenu className="gap-0.5">
              <SidebarMenuItem>
                <SidebarMenuButton asChild className={footLink}>
                  <Link to="/rules" className="no-underline">
                    Szabályzat
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* Feedback from any page (#240, spec 19): the form gets this page. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild className={footLink}>
                  <Link to={`/feedback?from=${encodeURIComponent(pathname + search)}`} className="no-underline">
                    Visszajelzés
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Form method="post" action="/logout">
                  <SidebarMenuButton type="submit" className={cn(footLink, "cursor-pointer")}>
                    Kilépés
                  </SidebarMenuButton>
                </Form>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <main className="pb-24 md:pb-0">
            <Outlet />
          </main>
          <TabBar tableHref={tableHref} unread={unread} initials={profile.initials} imageUrl={profile.imageUrl} team={profile.team} />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

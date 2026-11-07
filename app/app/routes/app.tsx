import { ArrowLeftRight, BarChart3, Bell, BellRing, BookOpen, Building2, CalendarDays, Check, ChevronsUpDown, Globe, Handshake, House, HeartHandshake, LayoutDashboard, LogOut, Mail, MapPin, Scale, ScrollText, Send, Swords, Trophy, UserCog, Users, UsersRound } from "lucide-react";
import { Form, Link, NavLink, Outlet, useLocation } from "react-router";


import type { Route } from "./+types/app";
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
  SidebarTrigger,
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
import { Logo } from "~/components/site";
import { getActor } from "~/lib/auth/admin.server";
import { appNav, navLeagues, roleLabel, type LeagueRef, type NavIcon, type NavSection } from "~/lib/auth/permissions";
import { initials, parseCookies } from "~/lib/auth/rules";
import { requireUser } from "~/lib/auth/session.server";
import { leagueFromPath, switchLeaguePath } from "~/lib/leagues";
import { listLeagues, playerLeagueSlug } from "~/lib/leagues.server";
import { unreadCount } from "~/lib/notifications.server";
import { SITE_NAME } from "~/lib/site";
import { cn } from "~/lib/utils";

// The app shell: one sidebar layout for every page of a logged-in user. The
// profile sits at the top; sections below it follow the user's roles.

// Logged in, with name and privacy consent, before any page in the shell.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }) => {
    await requireUser(request);
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const actor = (await getActor(request))!;
  return {
    name: user.name,
    email: user.email,
    imageUrl: user.imageUrl,
    initials: initials(user.name, user.email),
    role: roleLabel(actor),
    // The nav is built in the component from the URL (current league), with
    // the same pure function; the actor is the user's own data.
    actor,
    leagues: navLeagues(actor, actor.platformRole === "superadmin" ? await listLeagues() : []),
    // The badge on Értesítések (and the phone header's bell, app-page.tsx).
    unread: await unreadCount(user.id),
    // The league whose public table "Tabella" opens (D128).
    tableHref: await playerLeagueSlug(user.id).then((slug) => (slug ? `/league/${slug}` : null)),
    // The sidebar remembers open/closed in a cookie; read it so the first
    // render matches.
    sidebarOpen: parseCookies(request.headers.get("Cookie")).get("sidebar_state") !== "false",
  };
}

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  home: House,
  pair: Handshake,
  notifications: Bell,
  overview: LayoutDashboard,
  seasons: CalendarDays,
  matches: Swords,
  pairs: UsersRound,
  solos: HeartHandshake,
  disputes: Scale,
  substitutes: ArrowLeftRight,
  reminders: BellRing,
  signups: Users,
  broadcasts: Mail,
  outbox: Send,
  clubs: MapPin,
  traffic: BarChart3,
  leagues: Trophy,
  cities: Building2,
  users: UserCog,
  log: ScrollText,
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

// A section's title with its role tag (Szervező / Admin) on the right.
function SectionLabel({ label, role }: { label: string; role?: string }) {
  return (
    <>
      <span className="truncate">{label}</span>
      {role && (
        <span className="ml-auto shrink-0 rounded-full bg-nav-active-bg px-1.5 py-px text-[10px] font-semibold tracking-wide text-nav-active uppercase">
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
          <button type="button" className="w-full gap-1.5 hover:bg-sidebar-accent">
            <SectionLabel label={current} role={role} />
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

type ProfileProps = { name: string; email: string; imageUrl: string | null; initials: string; role: string };

function ProfileButton({ name, email, imageUrl, initials, role }: ProfileProps) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton asChild size="lg" isActive={isCurrent(pathname, "/profile")} tooltip="Profil">
          <NavLink to="/profile" onClick={() => setOpenMobile(false)} className="no-underline">
            <Avatar className="size-8">
              {imageUrl && <AvatarImage src={imageUrl} alt="" referrerPolicy="no-referrer" />}
              <AvatarFallback className="bg-nav-active-bg text-xs font-bold text-nav-active">{initials}</AvatarFallback>
            </Avatar>
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate font-semibold">{name || email}</span>
              <span className="truncate text-xs font-normal text-muted-foreground">{role}</span>
            </span>
          </NavLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function NavMenu({ nav, leagues, unread }: { nav: NavSection[]; leagues: LeagueRef[]; unread: number }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const active = activeItem(nav, pathname);
  return nav.map((section) => (
    <SidebarGroup key={section.label}>
      {/* The league section gets a switcher when there are more leagues. */}
      {leagues.length > 1 && leagues.some((l) => l.name === section.label) ? (
        <LeagueSwitcher leagues={leagues} current={section.label} role={section.role} />
      ) : (
        section.label && (
          <SidebarGroupLabel className="gap-1.5">
            <SectionLabel label={section.label} role={section.role} />
          </SidebarGroupLabel>
        )
      )}
      <SidebarMenu>
        {section.items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton asChild isActive={item.to === active} tooltip={item.label}>
                <NavLink to={item.to} onClick={() => setOpenMobile(false)} className="no-underline">
                  <Icon />
                  <span>{item.label}</span>
                </NavLink>
              </SidebarMenuButton>
              {item.to === "/notifications" && unread > 0 && (
                <SidebarMenuBadge className="bg-nav-active text-white peer-hover/menu-button:text-white peer-data-active/menu-button:text-white">
                  {unread > 99 ? "99+" : unread}
                </SidebarMenuBadge>
              )}
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  ));
}

// Phones (D128, docs/player-ui.md N1): the player's own pages one tap away at
// the bottom; the sidebar stays for the organizer's and the Admin's sections.
function TabBar({ tableHref, unread, initials, imageUrl }: { tableHref: string | null; unread: number; initials: string; imageUrl: string | null }) {
  const { pathname } = useLocation();
  const tabs = [
    { to: "/home", label: "Kezdőlap", icon: House },
    ...(tableHref ? [{ to: tableHref, label: "Tabella", icon: Trophy }] : []),
    { to: "/pair", label: "Párom", icon: Handshake },
    { to: "/notifications", label: "Értesítések", icon: Bell },
  ];
  const item = "relative grid min-w-0 flex-1 justify-items-center gap-0.5 px-1 pt-2 pb-1.5 text-[11px] font-medium no-underline";
  return (
    <nav
      aria-label="Fő menü"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {tabs.map(({ to, label, icon: Icon }) => {
        const active = isCurrent(pathname, to);
        return (
          <Link key={to} to={to} aria-current={active ? "page" : undefined} className={cn(item, active ? "text-nav-active" : "text-muted-foreground")}>
            <Icon className="size-5" />
            <span className="truncate">{label}</span>
            {to === "/notifications" && unread > 0 && (
              <span className="absolute top-1 left-1/2 ml-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-nav-active px-1 text-[10px] font-bold text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        );
      })}
      <Link
        to="/profile"
        aria-current={isCurrent(pathname, "/profile") ? "page" : undefined}
        className={cn(item, isCurrent(pathname, "/profile") ? "text-nav-active" : "text-muted-foreground")}
      >
        <Avatar className="size-5">
          {imageUrl && <AvatarImage src={imageUrl} alt="" referrerPolicy="no-referrer" />}
          <AvatarFallback className="bg-nav-active-bg text-[8px] font-bold text-nav-active">{initials}</AvatarFallback>
        </Avatar>
        <span className="truncate">Profil</span>
      </Link>
    </nav>
  );
}

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const { actor, leagues, sidebarOpen, unread, tableHref, ...profile } = loaderData;
  const { pathname } = useLocation();
  const base = appNav(actor, leagues, leagueFromPath(pathname));
  // The player's league table, after Kezdőlap (D128): the public page, one click away.
  const nav = tableHref
    ? base.map((section, i) =>
        i === 0 ? { ...section, items: [section.items[0]!, { label: "Tabella", to: tableHref, icon: "leagues" as const, permission: section.items[0]!.permission }, ...section.items.slice(1)] } : section,
      )
    : base;
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <Sidebar collapsible="icon">
          <SidebarHeader className="gap-3">
            <div className="flex items-center gap-2 pt-1 group-data-[collapsible=icon]:justify-center">
              <Link
                to="/home"
                aria-label={`${SITE_NAME}: kezdőlap`}
                className="min-w-0 px-2 text-base no-underline group-data-[collapsible=icon]:hidden"
              >
                <Logo />
              </Link>
              <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:ml-0" />
            </div>
            <ProfileButton {...profile} />
          </SidebarHeader>
          <SidebarContent>
            <NavMenu nav={nav} leagues={leagues} unread={unread} />
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
              {/* The public site, e.g. to reread how it works or the rules. */}
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="sm" className="text-muted-foreground" tooltip="Padelpárbaj főoldal">
                  <Link to="/" className="no-underline">
                    <Globe />
                    <span>Padelpárbaj főoldal</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild size="sm" className="text-muted-foreground" tooltip="Szabályzat">
                  <Link to="/rules" className="no-underline">
                    <BookOpen />
                    <span>Szabályzat</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <Form method="post" action="/logout">
                  <SidebarMenuButton type="submit" className="text-muted-foreground" tooltip="Kilépés">
                    <LogOut />
                    <span>Kilépés</span>
                  </SidebarMenuButton>
                </Form>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <main className="pb-20 md:pb-0">
            <Outlet />
          </main>
          <TabBar tableHref={tableHref} unread={unread} initials={profile.initials} imageUrl={profile.imageUrl} />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

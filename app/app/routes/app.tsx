import { BarChart3, Building2, Check, ChevronsUpDown, LayoutDashboard, LogOut, Mail, MapPin, Trophy, UserCog, Users } from "lucide-react";
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
import { getActor } from "~/lib/auth/admin.server";
import { appNav, navLeagues, roleLabel, type LeagueRef, type NavIcon, type NavSection } from "~/lib/auth/permissions";
import { initials, parseCookies } from "~/lib/auth/rules";
import { requireUser } from "~/lib/auth/session.server";
import { leagueFromPath, switchLeaguePath } from "~/lib/leagues";
import { listLeagues } from "~/lib/leagues.server";
import { SITE_NAME } from "~/lib/site";

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
    // The sidebar remembers open/closed in a cookie; read it so the first
    // render matches.
    sidebarOpen: parseCookies(request.headers.get("Cookie")).get("sidebar_state") !== "false",
  };
}

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  signups: Users,
  broadcasts: Mail,
  clubs: MapPin,
  traffic: BarChart3,
  leagues: Trophy,
  cities: Building2,
  users: UserCog,
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

function LeagueSwitcher({ leagues, current }: { leagues: LeagueRef[]; current: string }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarGroupLabel asChild>
          <button type="button" className="w-full justify-between hover:bg-sidebar-accent">
            <span className="truncate">{current}</span>
            <ChevronsUpDown className="ml-1" />
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

function NavMenu({ nav, leagues }: { nav: NavSection[]; leagues: LeagueRef[] }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  const active = activeItem(nav, pathname);
  return nav.map((section, index) => (
    <SidebarGroup key={section.label}>
      {/* The league section (first) gets a switcher when there are more. */}
      {index === 0 && leagues.length > 1 && leagues.some((l) => l.name === section.label) ? (
        <LeagueSwitcher leagues={leagues} current={section.label} />
      ) : (
        <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
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
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  ));
}

export default function AppShell({ loaderData }: Route.ComponentProps) {
  const { actor, leagues, sidebarOpen, ...profile } = loaderData;
  const { pathname } = useLocation();
  const nav = appNav(actor, leagues, leagueFromPath(pathname));
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <Sidebar collapsible="icon">
          <SidebarHeader className="gap-3">
            <div className="flex items-center gap-2 pt-1 group-data-[collapsible=icon]:justify-center">
              <Link
                to="/"
                className="flex min-w-0 items-center gap-2 px-2 text-base font-extrabold no-underline [font-stretch:120%] group-data-[collapsible=icon]:hidden"
              >
                <span
                  aria-hidden="true"
                  className="inline-block size-3 shrink-0 rounded-full bg-ball shadow-[inset_-3px_-2px_0_rgba(0,0,0,0.12)]"
                />
                {SITE_NAME}
              </Link>
              <SidebarTrigger className="ml-auto group-data-[collapsible=icon]:ml-0" />
            </div>
            <ProfileButton {...profile} />
          </SidebarHeader>
          <SidebarContent>
            <NavMenu nav={nav} leagues={leagues} />
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu>
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
          <main>
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

import { BarChart3, LogOut, Mail, MapPin, Users } from "lucide-react";
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
import { TooltipProvider } from "~/components/ui/tooltip";
import { getActor } from "~/lib/auth/admin.server";
import { appNav, roleLabel, type NavIcon, type NavSection } from "~/lib/auth/permissions";
import { initials, parseCookies } from "~/lib/auth/rules";
import { requireUser } from "~/lib/auth/session.server";
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
    nav: appNav(actor),
    // The sidebar remembers open/closed in a cookie; read it so the first
    // render matches.
    sidebarOpen: parseCookies(request.headers.get("Cookie")).get("sidebar_state") !== "false",
  };
}

const ICONS: Record<NavIcon, React.ComponentType<{ className?: string }>> = {
  signups: Users,
  broadcasts: Mail,
  clubs: MapPin,
  traffic: BarChart3,
};

const isCurrent = (pathname: string, to: string) => pathname === to || pathname.startsWith(`${to}/`);

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

function NavMenu({ nav }: { nav: NavSection[] }) {
  const { pathname } = useLocation();
  const { setOpenMobile } = useSidebar();
  return nav.map((section) => (
    <SidebarGroup key={section.label}>
      <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
      <SidebarMenu>
        {section.items.map((item) => {
          const Icon = ICONS[item.icon];
          return (
            <SidebarMenuItem key={item.to}>
              <SidebarMenuButton asChild isActive={isCurrent(pathname, item.to)} tooltip={item.label}>
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
  const { nav, sidebarOpen, ...profile } = loaderData;
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
            <NavMenu nav={nav} />
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

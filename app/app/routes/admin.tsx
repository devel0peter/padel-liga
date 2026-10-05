import { BarChart3, ChevronsUpDown, LogOut, Mail, MapPin, UserRound, Users } from "lucide-react";
import { Form, isRouteErrorResponse, Link, NavLink, Outlet, useLocation } from "react-router";

import type { Route } from "./+types/admin";
import { Forbidden } from "~/components/forbidden";
import { Badge } from "~/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
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
import { requirePermission } from "~/lib/auth/admin.server";
import { adminNav, roleLabel, type NavIcon, type NavSection } from "~/lib/auth/permissions";
import { parseCookies } from "~/lib/auth/rules";
import { SITE_NAME } from "~/lib/site";

export function meta({}: Route.MetaArgs) {
  return [{ title: `Admin – ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}

// Runs before every admin loader and action, including direct data requests,
// so no admin page is reachable without a session and an admin role.
export const middleware: Route.MiddlewareFunction[] = [
  async ({ request }) => {
    await requirePermission(request, { kind: "admin.enter" });
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const actor = await requirePermission(request, { kind: "admin.enter" });
  return {
    name: actor.name,
    email: actor.email,
    role: roleLabel(actor),
    nav: adminNav(actor),
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
              <SidebarMenuButton asChild isActive={pathname === item.to || pathname.startsWith(`${item.to}/`)}>
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

function UserMenu({ name, email, role }: { name: string; email: string; role: string }) {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate font-semibold">{name || email}</span>
                <span className="truncate text-xs text-muted-foreground">{role}</span>
              </span>
              <ChevronsUpDown className="ml-auto" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-56">
            <DropdownMenuLabel className="grid font-normal">
              <span className="truncate font-semibold">{name}</span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/account" className="no-underline">
                <UserRound />
                Fiókom
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <Form method="post" action="/logout">
              <DropdownMenuItem asChild>
                <button type="submit" className="w-full">
                  <LogOut />
                  Kilépés
                </button>
              </DropdownMenuItem>
            </Form>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function currentTitle(nav: NavSection[], pathname: string): string {
  for (const s of nav)
    for (const i of s.items) if (pathname === i.to || pathname.startsWith(`${i.to}/`)) return i.label;
  return "Admin";
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const { pathname } = useLocation();
  const { nav, name, email, role, sidebarOpen } = loaderData;
  return (
    <TooltipProvider>
      <SidebarProvider defaultOpen={sidebarOpen}>
        <Sidebar>
          <SidebarHeader>
            <Link
              to="/"
              className="flex items-center gap-2 px-2 py-1.5 text-base font-extrabold no-underline [font-stretch:120%]"
            >
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-full bg-ball shadow-[inset_-3px_-2px_0_rgba(0,0,0,0.12)]"
              />
              {SITE_NAME}
            </Link>
          </SidebarHeader>
          <SidebarContent>
            <NavMenu nav={nav} />
          </SidebarContent>
          <SidebarFooter>
            <UserMenu name={name} email={email} role={role} />
          </SidebarFooter>
        </Sidebar>
        <SidebarInset>
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <span className="text-sm font-semibold">{currentTitle(nav, pathname)}</span>
            <Badge variant="secondary" className="ml-auto">
              {role}
            </Badge>
          </header>
          <main className="py-6">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}

// 403 from a child loader or action; a 403 from the middleware reaches the
// root error boundary instead (it runs before any loader).
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 403) return <Forbidden />;
  throw error;
}

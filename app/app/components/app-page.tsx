import { ArrowLeft, Bell } from "lucide-react";
import { Link, useRouteLoaderData } from "react-router";

import { SidebarTrigger } from "~/components/ui/sidebar";

// The frame of every page in the logged-in app shell (app/routes/app.tsx):
// full width with even padding, one header row (menu button on phones, title,
// description, actions on the right), then the content. Pages use this
// instead of their own container or <h1>, so they all look the same.
export function AppPage({
  title,
  description,
  actions,
  back,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  // A parent page, shown above the title (e.g. Körlevelek above Új körlevél).
  back?: { to: string; label: string };
  children: React.ReactNode;
}) {
  // Phones don't see the sidebar's badge: a bell next to the title instead.
  const unread = useRouteLoaderData<{ unread?: number }>("routes/app")?.unread ?? 0;
  return (
    <div className="grid grid-cols-1 content-start gap-6 px-4 py-4 sm:px-6 lg:px-8 lg:py-6 [&>*]:min-w-0">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-3">
        {/* Phones: the sidebar is a slide-in panel, opened from here. On wider
            screens its own button (at its top) collapses it to icons. */}
        <SidebarTrigger className="mt-0.5 -ml-1.5 shrink-0 md:hidden" />
        <div className="grid min-w-0 flex-1 basis-64 gap-1">
          {back && (
            <Link
              to={back.to}
              className="flex w-fit items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" />
              {back.label}
            </Link>
          )}
          <h1 className="font-display text-2xl font-extrabold">{title}</h1>
          {description && <div className="max-w-3xl text-sm text-muted-foreground">{description}</div>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        <Link
          to="/notifications"
          aria-label={unread > 0 ? `Értesítések, ${unread} új` : "Értesítések"}
          className="relative -mr-1.5 grid size-8 shrink-0 place-items-center rounded-md text-foreground no-underline hover:bg-muted md:hidden"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-nav-active px-1 text-[10px] font-bold text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Link>
      </header>
      {children}
    </div>
  );
}

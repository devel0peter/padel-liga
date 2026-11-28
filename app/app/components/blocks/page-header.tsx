import { ChevronLeft, Menu } from "lucide-react";
import { Link, useRouteLoaderData } from "react-router";

import { useOptionalSidebar } from "~/components/ui/sidebar";
import { cn } from "~/lib/utils";

// The top of a player page (D181): an optional way back, one eyebrow line
// (where the page sits: season, city, round), the title in the display type,
// and an optional slot on the right (a round card, a button).
//
// On a phone, inside the app shell, the menu button sits top right: it opens
// the sidebar panel with everything the bottom bar doesn't hold (the
// organizer's and the Admin's sections, Szabályzat, Visszajelzés, Kilépés).
// From md up the sidebar is always there, so the button isn't.
export function PageHeader({
  title,
  eyebrow,
  aside,
  back,
}: {
  title: React.ReactNode;
  eyebrow?: React.ReactNode;
  aside?: React.ReactNode;
  back?: { to: string; label: string };
}) {
  const sidebar = useOptionalSidebar();
  const shell = useRouteLoaderData("routes/app") as { organizerWaitingCount?: number } | undefined;
  const orgBadge = shell?.organizerWaitingCount ?? 0;
  return (
    <header className="flex flex-col gap-2">
      {(back || sidebar) && (
        <div className={cn("flex min-h-11 items-center justify-between gap-3", !back && "md:hidden")}>
          {back ? (
            <Link
              to={back.to}
              className="-ml-1 flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
            >
              <ChevronLeft aria-hidden className="size-[18px]" />
              {back.label}
            </Link>
          ) : (
            <span />
          )}
          {sidebar && (
            <button
              type="button"
              aria-label={orgBadge > 0 ? `Menü (${orgBadge} szervezői teendő)` : "Menü"}
              aria-expanded={sidebar.openMobile}
              onClick={() => sidebar.setOpenMobile(true)}
              className="relative -mr-2 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-soft-foreground transition-colors hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring md:hidden"
            >
              <Menu aria-hidden className="size-6" />
              {orgBadge > 0 && (
                <span className="absolute top-1 right-1 grid h-4 min-w-4 place-items-center rounded-full bg-warning px-1 text-[10px] leading-none font-extrabold text-ball-foreground">
                  {orgBadge > 99 ? "99+" : orgBadge}
                </span>
              )}
            </button>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          {eyebrow && <div className="text-caption text-muted-foreground md:text-sm">{eyebrow}</div>}
          <h1 className="type-display m-0 text-[34px] break-words md:text-5xl">{title}</h1>
        </div>
        {/* Its width is the caller's: a button stays beside the title, a
            round card takes the line under it on a phone. */}
        {aside && <div className="ml-auto max-w-full min-w-0">{aside}</div>}
      </div>
    </header>
  );
}

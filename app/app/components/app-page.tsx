import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import { SidebarTrigger } from "~/components/ui/sidebar";

// The frame of every page in the logged-in app shell (app/routes/app.tsx):
// full width with even padding, one header row (sidebar button, title,
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
  return (
    <div className="grid grid-cols-1 content-start gap-6 px-4 py-4 sm:px-6 lg:px-8 lg:py-6 [&>*]:min-w-0">
      <header className="flex flex-wrap items-start gap-x-3 gap-y-3">
        <SidebarTrigger className="mt-0.5 -ml-1.5 shrink-0" />
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
      </header>
      {children}
    </div>
  );
}

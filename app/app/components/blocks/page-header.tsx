import { ChevronLeft } from "lucide-react";
import { Link } from "react-router";

// The top of a player page (D181): an optional way back, one eyebrow line
// (where the page sits: season, city, round), the title in the display type,
// and an optional slot on the right (a round card, a button).
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
  return (
    <header className="flex flex-col gap-2">
      {back && (
        <Link
          to={back.to}
          className="-ml-1 flex min-h-11 w-fit items-center gap-1 text-sm text-muted-foreground no-underline hover:text-foreground"
        >
          <ChevronLeft aria-hidden className="size-[18px]" />
          {back.label}
        </Link>
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

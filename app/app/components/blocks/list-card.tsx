import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { cn } from "~/lib/utils";

// A card of rows with thin dividers (D181): the player's matches, the ways
// out of a block ("Egyik sem jó?"), the partner and the rare actions.
export function ListCard({ label, className, children }: { label?: string; className?: string; children: React.ReactNode }) {
  return (
    <ul
      aria-label={label}
      data-slot="list-card"
      className={cn("m-0 list-none overflow-hidden rounded-2xl bg-surface p-0 [&>li+li]:border-t [&>li+li]:border-hairline", className)}
    >
      {children}
    </ul>
  );
}

const ROW = "flex min-h-12 w-full items-center gap-3 px-4 py-3.5 text-left md:px-5";
const ACTIVE = "text-inherit no-underline transition-colors hover:bg-surface-2/60 focus-visible:bg-surface-2/60 focus-visible:outline-none";

// One row of a ListCard. Plain (static), a link (`to`, with a chevron), or a
// button (`onClick`). `tone="accent"`: a yellow link row at the end of a card
// ("A csoport meccsei (6)").
export function ListRow({
  to,
  onClick,
  leading,
  description,
  trailing,
  chevron,
  tone = "default",
  className,
  children,
}: {
  to?: string;
  onClick?: () => void;
  leading?: React.ReactNode;
  description?: React.ReactNode;
  trailing?: React.ReactNode;
  // Defaults to true for a link or button row.
  chevron?: boolean;
  tone?: "default" | "accent";
  className?: string;
  children: React.ReactNode;
}) {
  const showChevron = chevron ?? Boolean(to || onClick);
  const body = (
    <>
      {leading && <span className="flex shrink-0 items-center">{leading}</span>}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn("text-body", tone === "accent" && "text-sm font-bold text-ball")}>{children}</span>
        {description && <span className="text-caption text-muted-foreground">{description}</span>}
      </span>
      {trailing && <span className="flex shrink-0 items-center gap-2 text-right">{trailing}</span>}
      {showChevron && (
        <ChevronRight aria-hidden className={cn("size-5 shrink-0", tone === "accent" ? "text-ball" : "text-muted-foreground")} />
      )}
    </>
  );
  return (
    <li className={className}>
      {to ? (
        <Link to={to} className={cn(ROW, ACTIVE)}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} className={cn(ROW, ACTIVE, "cursor-pointer")}>
          {body}
        </button>
      ) : (
        <div className={ROW}>{body}</div>
      )}
    </li>
  );
}

import { Ellipsis } from "lucide-react";
import { Link } from "react-router";

import { cn } from "~/lib/utils";

const ROW =
  "flex min-h-11 w-fit cursor-pointer items-center gap-2 px-1 text-sm text-muted-foreground no-underline transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

// The "•••" row for rare or destructive actions (D181): last on the page,
// muted. With `children` it opens in place (a native disclosure, so it works
// before the page's script loads); with `to` it leads to another page.
export function OverflowRow({ label, to, children }: { label: string; to?: string; children?: React.ReactNode }) {
  const head = (
    <>
      <Ellipsis aria-hidden className="size-5" />
      <span>{label}</span>
    </>
  );
  if (to)
    return (
      <Link to={to} className={ROW}>
        {head}
      </Link>
    );
  return (
    <details className="group">
      <summary className={cn(ROW, "list-none [&::-webkit-details-marker]:hidden group-open:text-foreground")}>{head}</summary>
      <div className="mt-2 flex flex-col gap-3">{children}</div>
    </details>
  );
}

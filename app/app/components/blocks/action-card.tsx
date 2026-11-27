import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

import { cn } from "~/lib/utils";

import type { StatusTone } from "./status-pill";

// One thing that waits on the player, under "Rád vár" (D181): a team badge or
// an icon, the title, one or two lines, and either the buttons (`actions`:
// at most one primary, the shadcn Button with size="xl") or a link to the
// page where it is done (`to`). `urgent`: the amber outline, for what has a
// deadline running (a result to confirm).
type Common = {
  leading?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  note?: React.ReactNode;
  urgent?: boolean;
  className?: string;
};

export function ActionCard(
  props: Common & ({ to: string; linkLabel?: string; actions?: never } | { to?: never; linkLabel?: never; actions?: React.ReactNode }),
) {
  const { leading, title, description, note, urgent = false, className } = props;
  const card = cn(
    "flex flex-col gap-3.5 rounded-2xl bg-surface p-4 text-foreground md:px-5 md:py-[18px]",
    urgent && "inset-ring inset-ring-warning/45",
    className,
  );
  const text = (Title: "h3" | "span") => (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <Title className="m-0 text-[17px] leading-snug font-bold md:text-lg">{title}</Title>
      {description && <span className="text-sm text-muted-foreground">{description}</span>}
      {note && <span className="text-caption text-muted-foreground">{note}</span>}
    </span>
  );
  if (props.to)
    return (
      <Link to={props.to} className={cn(card, "flex-row items-center gap-3 no-underline transition-colors hover:bg-surface-2/60 md:gap-4")}>
        {leading && <span className="flex shrink-0">{leading}</span>}
        {text("span")}
        {props.linkLabel && <span className="hidden shrink-0 text-sm font-bold text-ball md:inline">{props.linkLabel}</span>}
        <ChevronRight aria-hidden className={cn("size-5 shrink-0", "text-muted-foreground", props.linkLabel && "md:text-ball")} />
      </Link>
    );
  return (
    <article className={cn(card, "grid gap-x-3 md:gap-x-4", leading ? "grid-cols-[auto_minmax(0,1fr)]" : "grid-cols-1")}>
      {leading && <span className="flex shrink-0 pt-0.5 md:items-center md:pt-0">{leading}</span>}
      {text("h3")}
      {props.actions && (
        <div
          className={cn(
            "flex flex-wrap gap-2 [&>*:first-child]:flex-1 md:[&>*:first-child]:flex-none",
            leading && "col-span-2 md:col-span-1 md:col-start-2",
          )}
        >
          {props.actions}
        </div>
      )}
    </article>
  );
}

const ICON_TONES: Record<StatusTone, string> = {
  success: "bg-success-tint text-success",
  warning: "bg-warning-tint text-warning",
  info: "bg-info-tint text-info",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-surface-2 text-soft-foreground",
};

// An icon on a tinted square, for an ActionCard or a ListRow when there is no
// team (a notice, "Benne vagytok a 2. körben").
export function IconTile({ tone = "neutral", children }: { tone?: StatusTone; children: React.ReactNode }) {
  return (
    <span aria-hidden="true" className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-5", ICON_TONES[tone])}>
      {children}
    </span>
  );
}

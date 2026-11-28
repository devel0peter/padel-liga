import { cn } from "~/lib/utils";

// A team's label (D181) in the display style (page and card headers) or the
// body style (lists), with the "TI" tag on the viewer's own pair ("TE" on a
// player). The text comes from the caller: how pairs are named is #419's.
export function TeamName({
  name,
  variant = "body",
  own = false,
  ownTag = "TI",
  className,
}: {
  name: string;
  variant?: "display" | "body";
  own?: boolean;
  ownTag?: "TI" | "TE";
  className?: string;
}) {
  return (
    <span
      data-slot="team-name"
      className={cn(
        "inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1",
        variant === "display" ? "type-display" : own && "font-bold",
        className,
      )}
    >
      <span className="min-w-0 break-words">{name}</span>
      {own && <OwnTag tag={ownTag} />}
    </span>
  );
}

// The viewer's own pair or self, as on the mockups: a small yellow tag.
export function OwnTag({ tag = "TI" }: { tag?: "TI" | "TE" }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-ball/16 px-2 py-[3px] text-[11px] leading-none font-extrabold tracking-normal text-ball uppercase [font-stretch:100%]">
      {tag}
    </span>
  );
}

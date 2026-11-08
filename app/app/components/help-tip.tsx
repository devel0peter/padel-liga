import { useId } from "react";

import { cn } from "~/lib/utils";

// A "?" next to a page title whose explanation shows in a CSS tooltip (D138):
// on hover, and on tap or keyboard focus (focus-within keeps it open while a
// link inside it is used). Safari doesn't focus a button on click, so the
// click focuses it; Escape or a tap elsewhere closes it. The tooltip is
// positioned against the nearest `relative` ancestor (the title row), so it
// never runs off a 390 px screen.
export function HelpTip({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("group inline-flex", className)}>
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        onClick={(e) => e.currentTarget.focus()}
        onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
        className="grid size-6 shrink-0 place-items-center rounded-full border text-sm font-bold text-muted-foreground transition-colors outline-none hover:border-foreground/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 group-focus-within:border-foreground/40 group-focus-within:text-foreground"
      >
        ?
      </button>
      {/* Padding, not margin, above the box: the pointer keeps hovering on the way down. */}
      <div
        role="tooltip"
        id={id}
        className="invisible absolute inset-x-0 top-full z-50 pt-2 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100 sm:right-auto sm:w-96"
      >
        <div className="grid gap-2 rounded-lg border bg-popover p-3 font-sans text-sm font-normal text-popover-foreground shadow-md">
          {children}
        </div>
      </div>
    </div>
  );
}

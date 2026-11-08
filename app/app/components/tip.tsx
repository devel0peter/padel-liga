import { cn } from "~/lib/utils";

// A short CSS tooltip above its content (D143): shown on hover and, when
// `focusable`, on tap or keyboard focus (an element with a tabindex takes
// focus on a tap, also in Safari). Not focusable inside a link, where a
// second focus stop would nest interactive elements. The label is also read
// out to a screen reader by the caller's own sr-only text, not by this box.
export function Tip({ label, focusable = false, className, children }: { label: string; focusable?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <span tabIndex={focusable ? 0 : undefined} className={cn("group/tip relative inline-grid rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50", className)}>
      {children}
      <span
        aria-hidden
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-background opacity-0 shadow-md transition-opacity group-hover/tip:visible group-hover/tip:opacity-100 group-focus/tip:visible group-focus/tip:opacity-100"
      >
        {label}
      </span>
    </span>
  );
}

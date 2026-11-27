import { cn } from "~/lib/utils";

// The status colour map (D181, docs/ui-guidelines.md): green done or won,
// amber waits on the player ("Rád vár"), blue needs a time, red lost or
// a problem, neutral for the rest.
export type StatusTone = "success" | "warning" | "info" | "danger" | "neutral";

const TONES: Record<StatusTone, string> = {
  success: "bg-success-tint text-success",
  warning: "bg-warning-tint text-warning",
  info: "bg-info-tint text-info",
  danger: "bg-danger-tint text-danger",
  neutral: "bg-surface-3 text-soft-foreground",
};

// A short status in a tinted pill; the text comes from the caller.
// `emphasis`: the upper-case "RÁD VÁR" style at the top of an action block.
export function StatusPill({
  tone,
  emphasis = false,
  className,
  children,
}: {
  tone: StatusTone;
  emphasis?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      data-slot="status-pill"
      data-tone={tone}
      className={cn(
        "inline-flex w-fit shrink-0 items-center rounded-full text-xs leading-tight whitespace-nowrap",
        emphasis ? "px-2.5 py-1 font-extrabold tracking-[0.06em] uppercase" : "px-2 py-[3px] font-bold",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

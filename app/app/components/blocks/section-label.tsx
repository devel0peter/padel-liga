import { cn } from "~/lib/utils";

// A section's title above its card (D181): 13 px, bold, spaced, upper case.
// Amber only for the "Rád vár" section, the one that waits on the player.
export function SectionLabel({
  as: Tag = "h2",
  tone = "muted",
  id,
  className,
  children,
}: {
  as?: "h2" | "h3";
  tone?: "muted" | "warning";
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tag id={id} className={cn("type-label m-0", tone === "warning" ? "text-warning" : "text-muted-foreground", className)}>
      {children}
    </Tag>
  );
}

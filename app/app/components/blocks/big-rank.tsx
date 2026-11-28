import { cn } from "~/lib/utils";

// The pair's place as a big condensed number (D181), with its caption
// ("hely, 3 ponttal") and an optional detail line ("Bronz divízió · 1. csoport").
// Read together: "1. hely, 3 ponttal".
export function BigRank({
  place,
  caption,
  detail,
  size = "md",
}: {
  place: number;
  caption: React.ReactNode;
  detail?: React.ReactNode;
  size?: "md" | "lg";
}) {
  return (
    <div className="flex items-end gap-3">
      <span className={cn("type-display shrink-0 leading-[0.8] text-ball", size === "lg" ? "text-[84px]" : "text-[72px]")}>{place}.</span>
      <span className="flex min-w-0 flex-col gap-0.5 pb-0.5">
        <span className="text-lg leading-snug font-bold">{caption}</span>
        {detail && <span className="text-caption text-muted-foreground">{detail}</span>}
      </span>
    </div>
  );
}

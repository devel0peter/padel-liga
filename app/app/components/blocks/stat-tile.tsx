import { cn } from "~/lib/utils";

const number = new Intl.NumberFormat("hu-HU", { maximumFractionDigits: 1 });

// "+4", "−3", "±0": a change with its sign, decimal comma.
export function formatDelta(delta: number): string {
  if (delta > 0) return `+${number.format(delta)}`;
  if (delta < 0) return `−${number.format(-delta)}`;
  return "±0";
}

function Delta({ delta, className }: { delta: number; className?: string }) {
  return (
    <span className={cn("font-bold", delta > 0 ? "text-success" : delta < 0 ? "text-danger" : "text-muted-foreground", className)}>
      {formatDelta(delta)}
    </span>
  );
}

// A number as a tile (D181): a label over a condensed number, with an
// optional change ("+4"). `on`: what the tile sits on (a card or the page),
// which sets its own background. `size="lg"`: the one big number of a page
// (Élő-pont on Profil), in ball yellow, the change on the right.
export function StatTile({
  label,
  value,
  delta,
  deltaCaption,
  tone = "default",
  size = "md",
  on = "card",
}: {
  label: string;
  value: number | string;
  delta?: number;
  // Under the change on a large tile, e.g. "az utolsó meccsen".
  deltaCaption?: string;
  tone?: "default" | "success";
  size?: "md" | "lg";
  on?: "card" | "page";
}) {
  const shown = typeof value === "number" ? number.format(value) : value;
  if (size === "lg")
    return (
      <div data-slot="stat-tile" className="flex items-end justify-between gap-3 rounded-2xl bg-surface p-4">
        <span className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">{label}</span>
          <span className="type-display text-[56px] leading-[0.85] text-ball">{shown}</span>
        </span>
        {delta !== undefined && (
          <span className="flex flex-col items-end gap-0.5 text-right">
            <Delta delta={delta} className="text-body" />
            {deltaCaption && <span className="text-xs text-muted-foreground">{deltaCaption}</span>}
          </span>
        )}
      </div>
    );
  return (
    <div
      data-slot="stat-tile"
      className={cn("flex min-w-0 flex-col gap-0.5", on === "card" ? "rounded-xl bg-surface-2 px-3 py-2.5" : "rounded-[14px] bg-surface p-3")}
    >
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <span className={cn("type-display", on === "card" ? "text-2xl" : "text-[26px]", tone === "success" && "text-success")}>
        {shown}
        {delta !== undefined && <Delta delta={delta} className="ml-1.5 text-caption" />}
      </span>
    </div>
  );
}

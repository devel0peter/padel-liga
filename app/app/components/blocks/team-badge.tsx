import { cn } from "~/lib/utils";

// A pair's mark (D181): its two players' initials in two overlapping circles,
// the hue picked by the pair id (app.css --team-N), so a pair has the same
// colour on every page. Decorative: the team's name always sits next to it.

export type TeamBadgeSize = 20 | 30 | 40 | 56;

// How many hues there are (app.css --team-0 … --team-7).
export const TEAM_HUES = 8;

export function teamHue(pairId: number): number {
  return ((Math.trunc(pairId) % TEAM_HUES) + TEAM_HUES) % TEAM_HUES;
}

// The 20 px badge (table rows) has no letters.
const SIZES: Record<TeamBadgeSize, { circle: string; overlap: string; text?: string; ring: string }> = {
  20: { circle: "size-5", overlap: "-ml-[7px]", ring: "ring-2" },
  30: { circle: "size-[30px]", overlap: "-ml-1", text: "text-[11px] font-bold", ring: "ring-2" },
  40: { circle: "size-10", overlap: "-ml-[5px]", text: "text-[13px] font-bold", ring: "ring-2" },
  56: { circle: "size-14", overlap: "-ml-2", text: "text-[19px] font-extrabold", ring: "ring-[3px]" },
};

// The ring separates the circles; it takes the colour of what is behind.
const RINGS = { ground: "ring-background", surface: "ring-surface", "surface-2": "ring-surface-2" } as const;

export function TeamBadge({
  pairId,
  initials,
  size = 30,
  on = "surface",
  className,
}: {
  pairId: number;
  // The two players' initials, e.g. ["KA", "NB"]: from the caller.
  initials: readonly [string, string];
  size?: TeamBadgeSize;
  // The background the badge sits on.
  on?: keyof typeof RINGS;
  className?: string;
}) {
  const s = SIZES[size];
  const hue = teamHue(pairId);
  return (
    <span aria-hidden="true" data-slot="team-badge" className={cn("flex shrink-0", className)}>
      {initials.map((letters, i) => (
        <span
          key={i}
          className={cn(
            "grid place-items-center rounded-full leading-none text-foreground normal-case [font-stretch:100%]",
            s.circle,
            s.text,
            s.ring,
            RINGS[on],
            i === 1 && s.overlap,
          )}
          style={{ backgroundColor: `var(--team-${hue}${i === 1 ? "-light" : ""})` }}
        >
          {s.text ? letters : null}
        </span>
      ))}
    </span>
  );
}

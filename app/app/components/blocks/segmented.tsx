import { Link } from "react-router";

import { cn } from "~/lib/utils";

// A two- or three-way switch (D181). `tabs`: full width, the page's views
// (Csoportok | Ranglista, Profil | Beállítások). `pills`: small, a filter
// inside a view (Játékosok | Párok). With `to` on every option it is a nav of
// links (the URL holds the view); otherwise toggle buttons for the caller's
// state.
export type SegmentedOption = { value: string; label: React.ReactNode; to?: string };

const STYLES = {
  tabs: {
    list: "grid gap-1 rounded-xl bg-surface p-1",
    item: "flex h-11 items-center justify-center rounded-[9px] px-2 text-body font-semibold text-muted-foreground no-underline transition-colors hover:text-foreground",
    active: "bg-surface-3 font-bold text-foreground",
  },
  pills: {
    list: "flex flex-wrap gap-1.5",
    // 34 px to the eye, 44 px to the thumb (the ::after reaches out).
    item: "relative flex h-[34px] items-center rounded-full bg-surface px-3.5 text-sm font-semibold text-foreground no-underline transition-colors after:absolute after:inset-x-0 after:-inset-y-[5px] after:content-[''] hover:bg-surface-2",
    active: "bg-foreground font-bold text-ball-foreground hover:bg-foreground",
  },
} as const;

export function Segmented({
  label,
  options,
  value,
  onValueChange,
  variant = "tabs",
}: {
  // For screen readers: what the switch chooses ("Nézet").
  label: string;
  options: readonly SegmentedOption[];
  value: string;
  onValueChange?: (value: string) => void;
  variant?: keyof typeof STYLES;
}) {
  const style = STYLES[variant];
  const columns = variant === "tabs" ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined;
  const item = (active: boolean) => cn(style.item, "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring", active && style.active);
  if (options.every((o) => o.to))
    return (
      <nav aria-label={label} className={style.list} style={columns}>
        {options.map((o) => (
          <Link key={o.value} to={o.to!} aria-current={o.value === value ? "page" : undefined} className={item(o.value === value)}>
            {o.label}
          </Link>
        ))}
      </nav>
    );
  return (
    <div role="group" aria-label={label} className={style.list} style={columns}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onValueChange?.(o.value)}
          className={cn(item(o.value === value), "cursor-pointer")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

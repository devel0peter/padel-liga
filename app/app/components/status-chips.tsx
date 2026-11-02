import { Badge } from "~/components/ui/badge";
import type { StatusChip } from "~/lib/player-status";

// A player's status on the admin tables (lib/player-status.ts): done is
// filled, still to do is outlined, the rest is muted.
const VARIANT = { ok: "secondary", todo: "outline", muted: "outline" } as const;

export function StatusChips({ chips }: { chips: StatusChip[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1" data-testid="status">
      {chips.map((c) => (
        <Badge key={c.text} variant={VARIANT[c.tone]} className={c.tone === "muted" ? "text-muted-foreground" : undefined}>
          {c.text}
        </Badge>
      ))}
    </div>
  );
}

// What is left of the interest list's admin view since Jelentkezők went
// (#333, D129) and the list itself (#334): the names Napló shows for old
// signup entries, and the level columns' label. Pure.

import { LEVELS } from "./interest";

export const STATUSES = {
  new: "Új",
  contacted: "Megkeresve",
  paired: "Párosítva",
  withdrawn: "Visszalépett",
} as const;

export type Status = keyof typeof STATUSES;

export function levelLabel(level: string): string {
  const label = (LEVELS as Record<string, string>)[level];
  return label ? label.split(" – ")[0] : level;
}

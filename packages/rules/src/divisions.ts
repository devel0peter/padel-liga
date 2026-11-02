// Divisions (spec section 4): a virtual third of the ladder, top-down Bronz,
// Réz, Rookie. Labels only: fixtures, promotion and relegation don't change.
// Recalculated every phase from the number of groups.

export type Division = "bronz" | "rez" | "rookie";

/** Top-down order. */
export const DIVISIONS: readonly Division[] = ["bronz", "rez", "rookie"];

/**
 * Groups per division for `groupCount` groups in a phase: floor(n / 3) each; a
 * remainder of 1 goes to Réz, a remainder of 2 to Réz and Rookie (16 = 5+6+5,
 * 17 = 5+6+6). Fewer than 3 groups fill top-down: 1 = Bronz, 2 = Bronz and Réz.
 */
export function divisionSizes(groupCount: number): Record<Division, number> {
  if (!Number.isInteger(groupCount) || groupCount < 0) {
    throw new Error(`The number of groups must be a whole number, 0 or more (got ${groupCount})`);
  }
  if (groupCount < 3) return { bronz: Math.min(groupCount, 1), rez: Math.max(0, Math.min(groupCount - 1, 1)), rookie: 0 };
  const base = Math.floor(groupCount / 3);
  const remainder = groupCount % 3;
  return { bronz: base, rez: base + (remainder > 0 ? 1 : 0), rookie: base + (remainder === 2 ? 1 : 0) };
}

/** The division of the group at `index` (0 = 1. csoport) in a ladder of `groupCount` groups. */
export function divisionOfGroup(index: number, groupCount: number): Division {
  if (!Number.isInteger(index) || index < 0 || index >= groupCount) {
    throw new Error(`There is no group ${index} in a ladder of ${groupCount}`);
  }
  const sizes = divisionSizes(groupCount);
  return index < sizes.bronz ? "bronz" : index < sizes.bronz + sizes.rez ? "rez" : "rookie";
}

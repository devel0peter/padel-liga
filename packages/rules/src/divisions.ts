// Divisions (spec section 4): a virtual third of the ladder, by group count.
// Labels only: fixtures, promotion and relegation don't change. Pure: no I/O.

export const DIVISIONS = ["bronz", "rez", "rookie"] as const;
export type Division = (typeof DIVISIONS)[number];

export const DIVISION_NAMES: Record<Division, string> = { bronz: "Bronz", rez: "Réz", rookie: "Rookie" };

/**
 * How many groups each division gets with `groupCount` groups in the phase,
 * top-down: floor(n / 3) each, a remainder of 1 to Réz, of 2 to Réz and
 * Rookie (15 = 5+5+5, 16 = 5+6+5, 17 = 5+6+6). With fewer than 3 groups,
 * top-down: 1 = Bronz; 2 = Bronz, Réz.
 */
export function divisionSizes(groupCount: number): Record<Division, number> {
  if (!Number.isInteger(groupCount) || groupCount < 0) throw new Error(`Not a group count: ${groupCount}`);
  if (groupCount < 3) return { bronz: Math.min(groupCount, 1), rez: groupCount === 2 ? 1 : 0, rookie: 0 };
  const base = Math.floor(groupCount / 3);
  const rest = groupCount % 3;
  return { bronz: base, rez: base + (rest >= 1 ? 1 : 0), rookie: base + (rest === 2 ? 1 : 0) };
}

// The division of group `number` (1 = strongest) among `groupCount` groups.
export function divisionOf(number: number, groupCount: number): Division {
  if (!Number.isInteger(number) || number < 1 || number > groupCount) throw new Error(`No group ${number} of ${groupCount}`);
  const sizes = divisionSizes(groupCount);
  if (number <= sizes.bronz) return "bronz";
  if (number <= sizes.bronz + sizes.rez) return "rez";
  return "rookie";
}

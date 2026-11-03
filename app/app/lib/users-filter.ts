// The Felhasználók filters (/admin/users, #151). Pure: the page keeps them in
// the address, the loader filters and counts with these functions.
//
// Four groups, one value each. Within a group the options exclude each other;
// across groups they combine (and with the search). An option's count is what
// the list would show if the option were picked, with the other groups and
// the search applied (the group's own pick is left out).

import type { RoleLabel } from "./auth/permissions";
import type { PlayerStatus } from "./player-status";
import { matchesSearch } from "./search";

// What the filters look at, flat booleans from the same facts the status
// chips show (player-status.ts), so a filter and its chip always agree.
export type UserFacts = {
  role: RoleLabel;
  // Name and email: for the search only.
  name: string;
  email: string;
  registered: boolean;
  noLevel: boolean;
  noPhone: boolean;
  noPair: boolean;
  // Some active pair has no entry in its league's current or next season.
  notEntered: boolean;
  // Some active pair has an entry that counts (pending until #153, approved).
  entered: boolean;
};

export function userFacts(
  u: { role: RoleLabel; name: string; email: string },
  status: PlayerStatus | undefined,
): UserFacts {
  const registered = !!status?.registered;
  return {
    role: u.role,
    name: u.name,
    email: u.email,
    registered,
    // Like the chips: what's missing and the pair only for registered accounts.
    noLevel: registered && !status?.level,
    noPhone: registered && !status?.phone,
    noPair: registered && (status?.pairs.length ?? 0) === 0,
    notEntered: registered && !!status?.pairs.some((p) => !p.entry && p.season),
    entered: registered && !!status?.pairs.some((p) => p.entry && (p.entry.status === "pending" || p.entry.status === "approved")),
  };
}

type Group = {
  label: string;
  options: Record<string, { label: string; test: (f: UserFacts) => boolean }>;
};

export const USER_FILTERS = {
  role: {
    label: "Szerep",
    options: {
      player: { label: "Játékos", test: (f) => f.role === "Játékos" },
      organizer: { label: "Szervező", test: (f) => f.role === "Szervező" },
      admin: { label: "Admin", test: (f) => f.role === "Admin" },
    },
  },
  registration: {
    label: "Regisztráció",
    options: {
      unfinished: { label: "Félbehagyta a regisztrációt", test: (f) => !f.registered },
      done: { label: "Regisztrált", test: (f) => f.registered },
    },
  },
  missing: {
    label: "Hiányzó adat",
    options: {
      level: { label: "Nincs szintje", test: (f) => f.noLevel },
      phone: { label: "Nincs telefonszáma", test: (f) => f.noPhone },
    },
  },
  pair: {
    label: "Pár és nevezés",
    options: {
      none: { label: "Nincs párja", test: (f) => f.noPair },
      notEntered: { label: "Nem nevezett", test: (f) => f.notEntered },
      entered: { label: "Nevezett", test: (f) => f.entered },
    },
  },
} as const satisfies Record<string, Group>;

export type FilterKey = keyof typeof USER_FILTERS;
export const FILTER_KEYS = Object.keys(USER_FILTERS) as FilterKey[];

export type UserFilters = { q: string } & Record<FilterKey, string>;

// An unknown value (an old or hand-made link) counts as no filter.
export function parseUserFilters(params: URLSearchParams): UserFilters {
  const out = { q: (params.get("q") ?? "").trim() } as UserFilters;
  for (const key of FILTER_KEYS) {
    const value = params.get(key) ?? "";
    out[key] = Object.hasOwn(USER_FILTERS[key].options, value) ? value : "";
  }
  return out;
}

function passes(f: UserFacts, filters: UserFilters, skip?: FilterKey): boolean {
  if (!matchesSearch(filters.q, [f.name, f.email])) return false;
  return FILTER_KEYS.every((key) => {
    const value = filters[key];
    if (key === skip || !value) return true;
    const option: { test: (f: UserFacts) => boolean } = USER_FILTERS[key].options[value as never];
    return option.test(f);
  });
}

export function filterUsers<T extends { facts: UserFacts }>(rows: readonly T[], filters: UserFilters): T[] {
  return rows.filter((r) => passes(r.facts, filters));
}

export type FilterCounts = Record<FilterKey, Record<string, number>>;

export function filterCounts(rows: readonly { facts: UserFacts }[], filters: UserFilters): FilterCounts {
  const out = {} as FilterCounts;
  for (const key of FILTER_KEYS) {
    const others = rows.filter((r) => passes(r.facts, filters, key));
    out[key] = Object.fromEntries(
      Object.entries(USER_FILTERS[key].options).map(([value, o]) => [value, others.filter((r) => o.test(r.facts)).length]),
    );
  }
  return out;
}

// Any search or filter in use (the "clear" control and the description).
export function hasUserFilters(filters: UserFilters): boolean {
  return !!filters.q || FILTER_KEYS.some((k) => !!filters[k]);
}

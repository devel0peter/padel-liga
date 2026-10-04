// Admin view of the Phase 0 interest list: filtering, counts and CSV export.
// Pure (no I/O); the D1 access lives in signups-admin.server.ts.

import { CITIES, OTHER_CITY } from "./cities";
import { formatDateTime } from "./format";
import { LEVELS } from "./interest";

export const STATUSES = {
  new: "Új",
  contacted: "Megkeresve",
  paired: "Párosítva",
  withdrawn: "Visszalépett",
} as const;

export type Status = keyof typeof STATUSES;

export function isStatus(value: string): value is Status {
  return Object.hasOwn(STATUSES, value);
}

export type SignupRow = {
  id: number;
  city: string;
  cityOther: string | null;
  mode: "pair" | "solo";
  name1: string;
  email1: string;
  name2: string | null;
  email2: string | null;
  level: string;
  note: string | null;
  ref: string | null;
  homeClub: string | null;
  status: Status;
  adminNote: string | null;
  consentAt: Date;
  createdAt: Date;
  updatedAt: Date | null;
};

export type Filters = {
  city: string; // city slug, OTHER_CITY, or "" for all
  status: string; // Status or ""
  level: string; // Level or ""
  mode: string; // "pair" | "solo" | ""
  ref: string; // signup source (club slug or other ref), NO_REF, or ""
  club: string; // home club slug, OTHER_CLUB, NO_REF, or ""
  q: string;
};

export function parseFilters(params: URLSearchParams): Filters {
  const get = (k: string) => (params.get(k) ?? "").trim();
  return {
    city: get("city"),
    status: get("status"),
    level: get("level"),
    mode: get("mode"),
    ref: get("ref"),
    club: get("club"),
    q: get("q"),
  };
}

// Filter value for signups without a ref (or without a home club).
export const NO_REF = "none";

// Case- and accent-insensitive, so "kovacs" finds "Kovács".
function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function filterSignups(rows: SignupRow[], f: Filters): SignupRow[] {
  const q = fold(f.q);
  return rows.filter(
    (r) =>
      (!f.city || r.city === f.city) &&
      (!f.status || r.status === f.status) &&
      (!f.level || r.level === f.level) &&
      (!f.mode || r.mode === f.mode) &&
      (!f.ref || (f.ref === NO_REF ? !r.ref : r.ref === f.ref)) &&
      (!f.club || (f.club === NO_REF ? !r.homeClub : r.homeClub === f.club)) &&
      (!q ||
        [r.name1, r.email1, r.name2, r.email2, r.cityOther, r.note, r.adminNote].some(
          (v) => v != null && fold(v).includes(q),
        )),
  );
}

export type Counts = { signups: number; pairs: number; solo: number; players: number };

export function countSignups(rows: SignupRow[]): Counts {
  const pairs = rows.filter((r) => r.mode === "pair").length;
  const solo = rows.length - pairs;
  return { signups: rows.length, pairs, solo, players: pairs * 2 + solo };
}

export function cityLabel(r: Pick<SignupRow, "city" | "cityOther">): string {
  if (r.city === OTHER_CITY) return r.cityOther ? `${r.cityOther} (más város)` : "Más város";
  return CITIES.find((c) => c.slug === r.city)?.name ?? r.city;
}

export function levelLabel(level: string): string {
  const label = (LEVELS as Record<string, string>)[level];
  return label ? label.split(" – ")[0] : level;
}

// Semicolon-separated with a BOM: opens correctly in Hungarian Excel.
// `label` maps a ref or home club slug to its label (clubs.ts).
export function toCsv(
  rows: SignupRow[],
  label: { ref: (ref: string | null) => string; homeClub: (slug: string | null) => string } = {
    ref: (r) => r ?? "",
    homeClub: (c) => c ?? "",
  },
): string {
  const header = [
    "Azonosító", "Jelentkezett", "Város", "Mód", "Név 1", "E-mail 1", "Név 2", "E-mail 2",
    "Szint", "Megjegyzés", "Forrás", "Hol játszik", "Állapot", "Admin jegyzet",
  ];
  const cell = (v: string | number | null) => {
    const s = v == null ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = rows.map((r) =>
    [
      r.id,
      formatDateTime(r.createdAt),
      cityLabel(r),
      r.mode === "pair" ? "Pár" : "Egyéni",
      r.name1,
      r.email1,
      r.name2,
      r.email2,
      levelLabel(r.level),
      r.note,
      label.ref(r.ref),
      label.homeClub(r.homeClub),
      STATUSES[r.status],
      r.adminNote,
    ]
      .map(cell)
      .join(";"),
  );
  return "﻿" + [header.join(";"), ...lines].join("\r\n") + "\r\n";
}

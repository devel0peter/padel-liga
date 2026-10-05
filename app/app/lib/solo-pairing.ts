// A Szervező pairs up people who signed up alone (app/routes/admin.league-solos.tsx).
// Pure; the writes and the intro email live in solo-pairing.server.ts.

import { LEVELS } from "./interest";
import type { SignupRow } from "./signups-admin";

const LEVEL_ORDER = Object.keys(LEVELS);
const levelRank = (level: string) => {
  const i = LEVEL_ORDER.indexOf(level);
  return i === -1 ? LEVEL_ORDER.length : i;
};

type Solo = Pick<SignupRow, "id" | "city" | "mode" | "status" | "pairedWith" | "level" | "createdAt">;

const isSolo = (r: Solo, city: string) => r.mode === "solo" && r.city === city;

// Solos in the city still looking for a partner, by level, then oldest first,
// so similar players sit next to each other.
export function waitingSolos<T extends Solo>(rows: T[], city: string): T[] {
  return rows
    .filter((r) => isSolo(r, city) && r.pairedWith == null && r.status !== "withdrawn")
    .sort(
      (a, b) =>
        levelRank(a.level) - levelRank(b.level) ||
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
        a.id - b.id,
    );
}

// The pairs made so far in the city, each once, newest signup last.
export function soloPairs<T extends Solo>(rows: T[], city: string): [T, T][] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const pairs: [T, T][] = [];
  for (const a of rows) {
    if (!isSolo(a, city) || a.pairedWith == null) continue;
    const b = byId.get(a.pairedWith);
    if (b && a.id < b.id && b.pairedWith === a.id) pairs.push([a, b]);
  }
  return pairs;
}

// Why two signups can't be paired, or null if they can.
export function pairError(a: Solo | undefined, b: Solo | undefined, city: string): string | null {
  if (!a || !b) return "Nincs ilyen jelentkező.";
  if (a.id === b.id) return "Két különböző játékost válassz.";
  if (!isSolo(a, city) || !isSolo(b, city)) return "Csak a liga városában egyedül jelentkezőket lehet párba tenni.";
  if (a.status === "withdrawn" || b.status === "withdrawn") return "Visszalépett játékost nem lehet párba tenni.";
  if (a.pairedWith != null || b.pairedWith != null) return "Valamelyikük már párt kapott.";
  return null;
}

import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { pairs, users } from "~/db/schema";

import { asksSurname, nameInfo, sameWord, teamLabeler, type NamedPlayer } from "./names";

// The player's surname choice (#419, D182): Profil → Beállítások "Neved a
// tabellában" and Kezdőlap's one-time card. Reads the player's own name and
// their partner's name only; saves one of the player's own name parts.

/** What the setting and the card show. */
export type SurnameView = {
  /** The parts of the player's name: the chips. */
  parts: string[];
  /** The surname shown now (picked, or the rules' one). */
  surname: string;
  /** The team label as the tables show it, the player first: own part, partner's part (null without an active pair). */
  label: { own: string; partner: string | null };
  /** Kezdőlap asks: unsure and not yet answered. */
  asks: boolean;
};

const partner = alias(users, "surname_partner");

export async function surnameView(user: { id: string; name: string; surname: string | null }): Promise<SurnameView> {
  // The newest active pair: the one the tables show now.
  const [mate] = await db
    .select({ name: partner.name, surname: partner.surname })
    .from(pairs)
    .innerJoin(partner, sql`${partner.id} = case when ${pairs.playerA} = ${user.id} then ${pairs.playerB} else ${pairs.playerA} end`)
    .where(and(eq(pairs.status, "active"), or(eq(pairs.playerA, user.id), eq(pairs.playerB, user.id)), isNull(partner.deletedAt)))
    .orderBy(desc(pairs.id))
    .limit(1);
  const me: NamedPlayer = { name: user.name, surname: user.surname };
  const them: NamedPlayer | null = mate ? { name: mate.name || "Névtelen", surname: mate.surname } : null;
  const label = teamLabeler(them ? [me, them] : [me]);
  const info = nameInfo(me);
  return {
    parts: info.parts,
    surname: info.surname,
    label: { own: label([me]), partner: them ? label([them]) : null },
    asks: asksSurname(me),
  };
}

/**
 * Saves the part of the player's own name they picked as the surname. False
 * when it is not a part of the name (a stale form after a name change); the
 * write also checks the name it was picked from.
 */
export async function pickSurname(user: { id: string; name: string }, picked: unknown): Promise<boolean> {
  if (typeof picked !== "string") return false;
  const part = nameInfo({ name: user.name }).parts.find((p) => sameWord(p, picked));
  if (!part) return false;
  const [row] = await db
    .update(users)
    .set({ surname: part })
    .where(and(eq(users.id, user.id), eq(users.name, user.name), isNull(users.deletedAt)))
    .returning({ id: users.id });
  return !!row;
}

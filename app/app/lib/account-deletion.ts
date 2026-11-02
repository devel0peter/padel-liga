// Deleting an account (#152; the player's own button, #38, will use the same
// rules). Pure, so every rule is unit tested; the D1 side is
// account-deletion.server.ts.
//
// - Without history the account goes completely, with everything tied to it.
// - With history (a pair of theirs was placed in a published group, which is
//   also where every match comes from) it is anonymized: the name becomes
//   "Törölt játékos" and the contact data, login methods, sessions and
//   devices go, so other players' groups and results don't change.
// - Never while a pair of theirs plays in a published group whose phase
//   hasn't ended: the pair has to be withdrawn first (#34).
// - The Admin can't delete their own account or another Admin's.

export const DELETED_NAME = "Törölt játékos";

// The anonymized account keeps a unique, undeliverable address (the column
// is unique and required). `.invalid` is reserved (RFC 2606): no mail, no
// Google account can ever have it.
export function anonymizedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

export type DeletionRefusal = "self" | "admin" | "playing" | "gone";

export const DELETION_REFUSALS: Record<DeletionRefusal, string> = {
  self: "A saját fiókodat itt nem törölheted.",
  admin: "Admin fiókját nem törölheted.",
  playing:
    "Nem törölhető: a párja kihirdetett csoportban játszik, és a kör még nem ért véget. Előbb a párt vissza kell léptetni.",
  gone: "Ez a fiók már nincs meg.",
};

export type DeletionMode = "remove" | "anonymize";

export type DeletionCheck = {
  actorId: string;
  // Null: no such account, or it was already anonymized.
  target: { id: string; platformRole: "player" | "superadmin" } | null;
  // A pair of theirs is (or was) in a published group.
  history: boolean;
  // A pair of theirs is in a published group whose phase hasn't ended.
  playing: boolean;
};

export type DeletionPlan = { ok: true; mode: DeletionMode } | { ok: false; refusal: DeletionRefusal };

export function deletionPlan(c: DeletionCheck): DeletionPlan {
  if (!c.target) return { ok: false, refusal: "gone" };
  if (c.target.id === c.actorId) return { ok: false, refusal: "self" };
  if (c.target.platformRole === "superadmin") return { ok: false, refusal: "admin" };
  if (c.playing) return { ok: false, refusal: "playing" };
  return { ok: true, mode: c.history ? "anonymize" : "remove" };
}

// What the confirmation dialog says will happen.
export const DELETION_EFFECTS: Record<DeletionMode, string> = {
  remove:
    "Nincs lejátszott múltja, ezért minden adata törlődik: a fiók, a párjai, a nevezései, a párkeresése, az értesítései és a jelentkezése. Ha volt párja, ő pár nélkül marad. Senki nem kap róla e-mailt.",
  anonymize: `Volt már kihirdetett csoportban, ezért a fiók névtelen lesz: a neve „${DELETED_NAME}” lesz, az e-mail-címe, a telefonszáma, a belépései és az eszközei törlődnek, a csoportok és az eredmények nem változnak. Az aktív párja felbomlik. Senki nem kap róla e-mailt.`,
};

export const DELETED = { remove: "A fiók törölve.", anonymize: "A fiók névtelen lett." } as const;

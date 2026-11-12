// Deleting an account: the Admin's "Törlés" (#152) and the player's own
// "Fiók törlése" on the profile (#38), with the same rules. Pure, so every rule is unit tested; the D1 side is
// account-deletion.server.ts.
//
// - Without history the account goes completely, with everything tied to it.
// - With history (a pair of theirs was placed in a published group, which is
//   also where every match comes from, or they were an approved substitute
//   in a match, #37) it is anonymized: the name becomes
//   "Törölt játékos" and the contact data, login methods, sessions and
//   devices go, so other players' groups and results don't change.
// - Never while a pair of theirs plays in a published group whose phase
//   hasn't ended: the pair has to be withdrawn first (#34).
// - The Admin can't delete their own account or another Admin's, on either
//   path. A Szervező deletes their own like any player and loses the rights.

export const DELETED_NAME = "Törölt játékos";

// The anonymized account keeps a unique, undeliverable address (the column
// is unique and required). `.invalid` is reserved (RFC 2606): no mail, no
// Google account can ever have it.
export function anonymizedEmail(userId: string): string {
  return `deleted-${userId}@deleted.invalid`;
}

// Such an address never gets a login code (it can't receive one anyway).
export function isAnonymizedEmail(email: string): boolean {
  return /@deleted\.invalid$/i.test(email.trim());
}

// The mail kinds whose text names other people (a partner, opponents, the
// signer): an unsent one with the deleted person's name in it is deleted.
// Other kinds name only the recipient, whose own name may be the same.
export const MAIL_KINDS_NAMING_OTHERS = [
  "partner_notice",
  "pair_intro",
  "season_entry_decision",
  "groups_published",
  "match_proposal",
  "match_agreed_time",
  "match_result",
  "match_tomorrow",
  "stuck_reminder",
] as const;

// "Szia <recipient>!" opens every mail; a namesake recipient isn't the
// deleted person, so their own greeting doesn't count.
const GREETING = /^\s*Szia(?: [^!\n]*)?!/u;

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Whether an unsent mail's text has the deleted person in it (#152): their
// address as a whole address (not the end of "anna@x.hu" for "a@x.hu"), or,
// in a kind that names other people, their name as whole words (not
// "Annamária" for "Anna") after the greeting. Names under 3 letters are not
// matched.
export function mailNamesPerson(mail: { kind: string; text: string | null }, person: { email: string; name: string }): boolean {
  const text = mail.text ?? "";
  const email = person.email.trim().toLowerCase();
  if (email && new RegExp(`(^|[^a-z0-9._%+-])${escapeRegExp(email)}($|[^a-z0-9.-]|\\.(?![a-z0-9]))`, "i").test(text)) return true;
  const name = person.name.trim();
  if (name.length < 3 || !(MAIL_KINDS_NAMING_OTHERS as readonly string[]).includes(mail.kind)) return false;
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}($|[^\\p{L}\\p{N}])`, "u").test(text.replace(GREETING, ""));
}

export type DeletionRefusal = "self" | "admin" | "playing" | "gone" | "ownAdmin" | "ownPlaying";

export const DELETION_REFUSALS: Record<DeletionRefusal, string> = {
  self: "A saját fiókodat itt nem törölheted.",
  admin: "Admin fiókját nem törölheted.",
  playing:
    "Nem törölhető: a párja kihirdetett csoportban játszik, és a kör még nem ért véget. Előbb a párt vissza kell léptetni.",
  gone: "Ez a fiók már nincs meg.",
  // The player's own button (#38): the same reasons, said to them.
  ownAdmin: "Adminként a saját fiókodat nem törölheted.",
  ownPlaying:
    "Most nem törölheted: a párod kihirdetett csoportban játszik, és a kör még nem ért véget. Előbb a szervezőnek vissza kell léptetnie a párodat.",
};

export type DeletionMode = "remove" | "anonymize";

// Who deletes: the Admin on Felhasználók, or the player their own account.
export type DeletionBy = "admin" | "own";

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

export function deletionPlan(c: DeletionCheck, by: DeletionBy = "admin"): DeletionPlan {
  if (!c.target) return { ok: false, refusal: "gone" };
  if (by === "own") {
    // Only ever one's own account.
    if (c.target.id !== c.actorId) return { ok: false, refusal: "gone" };
    if (c.target.platformRole === "superadmin") return { ok: false, refusal: "ownAdmin" };
    if (c.playing) return { ok: false, refusal: "ownPlaying" };
  } else {
    if (c.target.id === c.actorId) return { ok: false, refusal: "self" };
    if (c.target.platformRole === "superadmin") return { ok: false, refusal: "admin" };
    if (c.playing) return { ok: false, refusal: "playing" };
  }
  return { ok: true, mode: c.history ? "anonymize" : "remove" };
}

// What the confirmation dialog says will happen.
export const DELETION_EFFECTS: Record<DeletionMode, string> = {
  remove:
    "Nincs lejátszott múltja, ezért minden adata törlődik: a fiók, a párjai, a nevezései, a párkeresése, az értesítései és a címéhez tartozó minden tárolt adat, a leiratkozás vagy visszapattanás nyoma is. Ha újra regisztrál ezzel a címmel, tiszta lappal indul. Ha volt párja, ő pár nélkül marad. Senki nem kap róla e-mailt.",
  anonymize: `Volt már kihirdetett csoportban, ezért a fiók névtelen lesz: a neve „${DELETED_NAME}” lesz, az e-mail-címe, a telefonszáma, a belépései, az eszközei, a visszajelzései és a címéhez tartozó minden tárolt adat (a leiratkozás vagy visszapattanás nyoma is) törlődik, a régi eredményekben csak a névtelen neve marad. Ha újra regisztrál ezzel a címmel, tiszta lappal indul. A csoportok és az eredmények nem változnak. Az aktív párja felbomlik. Senki nem kap róla e-mailt.`,
};

export const DELETED = { remove: "A fiók törölve.", anonymize: "A fiók névtelen lett." } as const;

// What the player's own confirmation says (#38), in their words.
export const OWN_DELETION_EFFECTS: Record<DeletionMode, string> = {
  remove:
    "Még nem szerepeltél a ligában, ezért minden adatod törlődik: a fiókod, a párosaid, a nevezéseid, a párkeresésed és az értesítéseid. Ha van párod, ő pár nélkül marad.",
  anonymize: `Már szerepeltél a ligában, ezért a fiókod névtelen lesz: a neved helyén „${DELETED_NAME}” áll, az e-mail-címed, a telefonszámod, a belépéseid és a visszajelzéseid törlődnek. Az eredmények és a tabellák nem változnak. Ha van párod, a párosotok felbomlik.`,
};

// Said after either effect: the Szervező rights, the login, no way back.
export function ownDeletionNote(organizer: boolean): string {
  const rights = organizer ? "A szervezői jogaid is megszűnnek. " : "";
  return `${rights}Minden eszközön kilépünk, és ebbe a fiókba többé nem tudsz belépni. Ha később újra regisztrálsz, tiszta lappal indulsz. Senki nem kap róla e-mailt. Nem vonható vissza.`;
}

// The home page's line after the player deleted their own account (#38).
export const OWN_DELETED = "Töröltük a fiókodat, és minden eszközön kiléptettünk.";

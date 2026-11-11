// The Admin's player profile (#301, D156): the address, and the edit of a
// player's name, phone, level and sex. Pure, so every rule is unit tested;
// the D1 side is player-admin.server.ts.

import { MAX_NAME, parseSex, SEX_REQUIRED, type Sex } from "./auth/rules";
import { isLevel, type Level } from "./interest";
import { parsePhone } from "./phone";

export const adminProfilePath = (userId: string) => `/admin/users/${encodeURIComponent(userId)}`;

export type EditableProfile = { name: string; phone: string | null; level: Level | null; sex: Sex | null };
export type ProfileField = keyof EditableProfile;
export type AdminProfileErrors = Partial<Record<ProfileField, string>>;

// The words Napló's entry uses for the fields that changed.
export const FIELD_LABELS: Record<ProfileField, string> = { name: "név", phone: "telefonszám", level: "szint", sex: "nem" };

export const LEVEL_LOCKED_ADMIN = "A szintje lezárult: már játszott a ligában, az eredményei döntik el, hol tart.";

// What the Admin's form may save. Like the player's own form
// (auth/rules.ts validateProfile), but a field the player never filled in
// may stay empty: the Admin fixes what is there, they don't have to know
// everything. A field that has a value can't be emptied. A locked level
// (D79: the player took part in a season) can't change, for the Admin
// either.
export function validateAdminProfile(
  input: { name: unknown; phone: unknown; level: unknown; sex: unknown },
  stored: EditableProfile,
  levelLocked: boolean,
): { ok: true; value: EditableProfile } | { ok: false; errors: AdminProfileErrors } {
  const errors: AdminProfileErrors = {};
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const name = text(input.name).replace(/\s+/g, " ");
  if (name.length < 2) errors.name = "Add meg a nevét.";
  else if (name.length > MAX_NAME) errors.name = `Legfeljebb ${MAX_NAME} karakter.`;

  const phone = parsePhone(input.phone);
  if (!phone.ok) errors.phone = phone.error;
  else if (!phone.value && stored.phone) errors.phone = "A telefonszámot nem törölheted, csak javíthatod.";

  // A locked level isn't on the form; a post that sends another one anyway
  // is refused.
  const rawLevel = text(input.level);
  const level = isLevel(rawLevel) ? rawLevel : null;
  if (levelLocked) {
    if (rawLevel && rawLevel !== stored.level) errors.level = LEVEL_LOCKED_ADMIN;
  } else if (rawLevel ? !level : !!stored.level) errors.level = "Válassz szintet.";

  const rawSex = text(input.sex);
  const sex = parseSex(rawSex);
  if (rawSex && !sex) errors.sex = SEX_REQUIRED;
  else if (!sex && stored.sex) errors.sex = SEX_REQUIRED;

  if (Object.keys(errors).length > 0 || !phone.ok) return { ok: false, errors };
  return {
    ok: true,
    value: {
      name,
      phone: phone.value,
      // A locked level is kept as it is, whatever the form sent.
      level: levelLocked ? stored.level : level,
      sex,
    },
  };
}

// The fields whose value changes, in form order.
export function changedFields(stored: EditableProfile, next: EditableProfile): ProfileField[] {
  return (Object.keys(FIELD_LABELS) as ProfileField[]).filter((k) => (stored[k] ?? null) !== (next[k] ?? null));
}

// Napló's detail for the edit: which fields changed, never the values
// (they are personal data; the profile shows the current ones).
export function editDetail(fields: readonly ProfileField[]): string {
  return `Módosítva: ${fields.map((f) => FIELD_LABELS[f]).join(", ")}`;
}

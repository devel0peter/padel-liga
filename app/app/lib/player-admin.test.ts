import { describe, expect, it } from "vitest";

import { adminProfilePath, changedFields, profileLink, editDetail, LEVEL_LOCKED_ADMIN, validateAdminProfile, type EditableProfile } from "./player-admin";

const FULL: EditableProfile = { surname: "Kovács", firstName: "Anna", phone: "+36301234567", level: "kezdo", sex: "female" };
// An old one-word account (#419: the migration gave it only a surname).
const EMPTY: EditableProfile = { surname: "Régi", firstName: null, phone: null, level: null, sex: null };
const form = (o: Partial<Record<keyof EditableProfile, string>> = {}) => ({
  surname: "Kovács",
  firstName: "Anna",
  phone: "06 30 123 4567",
  level: "kezdo",
  sex: "female",
  ...o,
});

describe("validateAdminProfile (#301, D156)", () => {
  it("saves a corrected name in two parts, the full name with it, and a phone in any Hungarian format, as E.164", () => {
    expect(validateAdminProfile(form({ surname: "  Kiss-Nagy ", firstName: " Anna   Mária ", phone: "+36 20 987 6543" }), FULL, false)).toEqual({
      ok: true,
      value: { name: "Kiss-Nagy Anna Mária", surname: "Kiss-Nagy", firstName: "Anna Mária", phone: "+36209876543", level: "kezdo", sex: "female" },
    });
  });

  it("refuses a missing surname, emptying a first name, and a too long name", () => {
    expect(validateAdminProfile(form({ surname: " " }), FULL, false)).toMatchObject({ ok: false, errors: { surname: "Add meg a vezetéknevét." } });
    expect(validateAdminProfile(form({ firstName: "" }), FULL, false)).toMatchObject({ ok: false, errors: { firstName: expect.stringMatching(/nem törölheted/) } });
    expect(validateAdminProfile(form({ firstName: "x".repeat(80) }), FULL, false)).toMatchObject({
      ok: false,
      errors: { firstName: "A teljes neve legfeljebb 80 karakter." },
    });
  });

  it("refuses a bad phone number, and emptying one that is there", () => {
    expect(validateAdminProfile(form({ phone: "12345" }), FULL, false)).toMatchObject({ ok: false, errors: { phone: expect.any(String) } });
    expect(validateAdminProfile(form({ phone: "" }), FULL, false)).toMatchObject({ ok: false, errors: { phone: expect.stringMatching(/nem törölheted/) } });
  });

  it("lets a field the player never filled in stay empty", () => {
    expect(validateAdminProfile({ surname: "Régi", firstName: "", phone: "", level: "", sex: "" }, EMPTY, false)).toEqual({
      ok: true,
      value: { ...EMPTY, name: "Régi" },
    });
  });

  it("refuses emptying a level or sex that is there, and unknown values", () => {
    expect(validateAdminProfile(form({ level: "" }), FULL, false)).toMatchObject({ ok: false, errors: { level: "Válassz szintet." } });
    expect(validateAdminProfile(form({ level: "pro" }), FULL, false)).toMatchObject({ ok: false, errors: { level: "Válassz szintet." } });
    expect(validateAdminProfile(form({ sex: "" }), FULL, false)).toMatchObject({ ok: false, errors: { sex: expect.any(String) } });
    expect(validateAdminProfile(form({ sex: "other" }), FULL, false)).toMatchObject({ ok: false, errors: { sex: expect.any(String) } });
  });

  it("changes the level only while it isn't locked (D79: no override for the Admin either)", () => {
    expect(validateAdminProfile(form({ level: "halado" }), FULL, false)).toMatchObject({ ok: true, value: { level: "halado" } });
    expect(validateAdminProfile(form({ level: "halado" }), FULL, true)).toEqual({ ok: false, errors: { level: LEVEL_LOCKED_ADMIN } });
    // The form leaves a locked level out; the stored one stays.
    expect(validateAdminProfile(form({ level: "" }), FULL, true)).toMatchObject({ ok: true, value: { level: "kezdo" } });
    expect(validateAdminProfile(form({ level: "kezdo" }), FULL, true)).toMatchObject({ ok: true, value: { level: "kezdo" } });
  });
});

describe("changedFields and editDetail", () => {
  it("names the fields whose value changes, in form order", () => {
    expect(changedFields(FULL, FULL)).toEqual([]);
    expect(changedFields(FULL, { ...FULL, sex: "male", firstName: "Anikó" })).toEqual(["firstName", "sex"]);
    expect(changedFields(EMPTY, { ...EMPTY, phone: "+36301234567" })).toEqual(["phone"]);
  });

  it("Napló's detail names the fields, never their values", () => {
    const detail = editDetail(["surname", "firstName", "phone", "level", "sex"]);
    expect(detail).toBe("Módosítva: vezetéknév, keresztnév, telefonszám, szint, nem");
    expect(detail).not.toMatch(/\d/);
  });
});

describe("profileLink (#301)", () => {
  it("links a player's name for the Admin only", () => {
    expect(profileLink("u-1", "Kovács Anna", true)).toBe("/admin/users/u-1");
    expect(profileLink("u-1", "Kovács Anna", false)).toBeNull();
  });

  it("leaves an anonymized account and a name without an account as plain text", () => {
    expect(profileLink("u-2", "Törölt játékos", true)).toBeNull();
    expect(profileLink(null, "Szervező", true)).toBeNull();
    expect(profileLink(undefined, "Padelpárbaj", true)).toBeNull();
  });
});

describe("adminProfilePath", () => {
  it("is under Felhasználók, so the sidebar marks it", () => {
    expect(adminProfilePath("u-1")).toBe("/admin/users/u-1");
  });
});

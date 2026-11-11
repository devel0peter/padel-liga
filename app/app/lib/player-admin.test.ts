import { describe, expect, it } from "vitest";

import { adminProfilePath, changedFields, editDetail, LEVEL_LOCKED_ADMIN, validateAdminProfile, type EditableProfile } from "./player-admin";

const FULL: EditableProfile = { name: "Kovács Anna", phone: "+36301234567", level: "kezdo", sex: "female" };
const EMPTY: EditableProfile = { name: "Régi Fiók", phone: null, level: null, sex: null };
const form = (o: Partial<Record<keyof EditableProfile, string>> = {}) => ({ name: "Kovács Anna", phone: "06 30 123 4567", level: "kezdo", sex: "female", ...o });

describe("validateAdminProfile (#301, D156)", () => {
  it("saves a corrected name and a phone in any Hungarian format, as E.164", () => {
    expect(validateAdminProfile(form({ name: "  Kovács   Anna ", phone: "+36 20 987 6543" }), FULL, false)).toEqual({
      ok: true,
      value: { name: "Kovács Anna", phone: "+36209876543", level: "kezdo", sex: "female" },
    });
  });

  it("refuses a too short or too long name", () => {
    expect(validateAdminProfile(form({ name: "A" }), FULL, false)).toMatchObject({ ok: false, errors: { name: "Add meg a nevét." } });
    expect(validateAdminProfile(form({ name: "x".repeat(81) }), FULL, false)).toMatchObject({ ok: false, errors: { name: "Legfeljebb 80 karakter." } });
  });

  it("refuses a bad phone number, and emptying one that is there", () => {
    expect(validateAdminProfile(form({ phone: "12345" }), FULL, false)).toMatchObject({ ok: false, errors: { phone: expect.any(String) } });
    expect(validateAdminProfile(form({ phone: "" }), FULL, false)).toMatchObject({ ok: false, errors: { phone: expect.stringMatching(/nem törölheted/) } });
  });

  it("lets a field the player never filled in stay empty", () => {
    expect(validateAdminProfile({ name: "Régi Fiók", phone: "", level: "", sex: "" }, EMPTY, false)).toEqual({ ok: true, value: EMPTY });
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
    expect(changedFields(FULL, { ...FULL, sex: "male", name: "Kovács A." })).toEqual(["name", "sex"]);
    expect(changedFields(EMPTY, { ...EMPTY, phone: "+36301234567" })).toEqual(["phone"]);
  });

  it("Napló's detail names the fields, never their values", () => {
    const detail = editDetail(["name", "phone", "level", "sex"]);
    expect(detail).toBe("Módosítva: név, telefonszám, szint, nem");
    expect(detail).not.toMatch(/\d/);
  });
});

describe("adminProfilePath", () => {
  it("is under Felhasználók, so the sidebar marks it", () => {
    expect(adminProfilePath("u-1")).toBe("/admin/users/u-1");
  });
});

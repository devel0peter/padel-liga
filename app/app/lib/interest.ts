// Phase 0 interest signup: parsing and validation of the landing page form.
// Pure (no I/O) so it runs on both server and client and can be unit tested.

import { isCity, type CitySlug } from "./cities";

export const LEVELS = {
  kezdo: "Kezdő – most ismerkedünk a játékkal",
  kozephalado: "Középhaladó – rendszeresen játszunk",
  halado: "Haladó – versenyeken is indulunk",
  versenyzo: "Versenyző – eredményesen versenyzünk",
} as const;

export type Level = keyof typeof LEVELS;
export type Mode = "pair" | "solo";

export type InterestSignup = {
  city: CitySlug;
  mode: Mode;
  name1: string;
  email1: string;
  name2: string | null;
  email2: string | null;
  level: Level;
  note: string | null;
};

export type InterestField =
  | "city"
  | "name1"
  | "email1"
  | "name2"
  | "email2"
  | "level"
  | "note"
  | "consent";

export type InterestResult =
  | { ok: true; data: InterestSignup }
  | { ok: false; errors: Partial<Record<InterestField, string>> };

const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_NOTE = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function str(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isLevel(value: string): value is Level {
  return Object.hasOwn(LEVELS, value);
}

export function parseInterest(form: FormData): InterestResult {
  const city = str(form, "city");
  const mode: Mode = str(form, "mode") === "solo" ? "solo" : "pair";
  const name1 = str(form, "name1");
  const email1 = str(form, "email1").toLowerCase();
  const name2 = mode === "pair" ? str(form, "name2") : "";
  const email2 = mode === "pair" ? str(form, "email2").toLowerCase() : "";
  const level = str(form, "level");
  const note = str(form, "note");
  const consent = form.get("consent") != null;

  const errors: Partial<Record<InterestField, string>> = {};

  if (!isCity(city)) errors.city = "Válaszd ki a várost.";

  if (!name1) errors.name1 = "Add meg a neved.";
  else if (name1.length > MAX_NAME) errors.name1 = "Ez a név túl hosszú.";

  if (!EMAIL_RE.test(email1) || email1.length > MAX_EMAIL)
    errors.email1 = "Adj meg egy érvényes e-mail-címet.";

  if (mode === "pair") {
    if (!name2)
      errors.name2 =
        "Add meg a párod nevét, vagy válaszd az egyéni jelentkezést.";
    else if (name2.length > MAX_NAME) errors.name2 = "Ez a név túl hosszú.";

    if (email2 && (!EMAIL_RE.test(email2) || email2.length > MAX_EMAIL))
      errors.email2 = "A párod e-mail-címe nem érvényes.";
    else if (email2 && email2 === email1)
      errors.email2 = "A párod e-mail-címe nem lehet ugyanaz, mint a tiéd.";
  }

  if (!isLevel(level)) errors.level = "Válaszd ki a szinteteket.";

  if (note.length > MAX_NOTE)
    errors.note = `A megjegyzés legfeljebb ${MAX_NOTE} karakter lehet.`;

  if (!consent)
    errors.consent = "A jelentkezéshez el kell fogadnod az adatkezelést.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      city: city as CitySlug,
      mode,
      name1,
      email1,
      name2: name2 || null,
      email2: email2 || null,
      level: level as Level,
      note: note || null,
    },
  };
}

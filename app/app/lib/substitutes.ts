// Temporary substitutes (#400, spec 4, D175): the Hungarian texts. The rules
// are in packages/rules (substitutes.ts); the marks in substitutes.server.ts.
// A pair marks which of its players doesn't (or didn't) play a match;
// anyone plays instead, unnamed, with no approval. This replaced the named
// and approved substitute of D109, hidden since D145.
import type { AbsenceRefusal } from "@padel-liga/rules";

export const ABSENCE_REFUSALS: Record<AbsenceRefusal, string> = {
  closed: "Ezt már nem lehet: a meccs elkezdődött, van eredménye, vagy nem számít. Ha helyettes játszott, az eredménnyel együtt jelöld.",
  not_own: "Csak a saját párod játékosát jelölheted.",
  already: "Őt már jelölted.",
  not_marked: "Őt nem jelölte senki.",
};

export const ABSENCE_CHANGED = "Közben változott a meccs. Nézd meg újra, és próbáld még egyszer.";

// "helyett helyettes játszik" / "játszott": after the name, also a linked one.
// `substitute`: the new partner of a permanent partner change (#402), named.
export const absenceTail = (played: boolean, substitute?: string | null) => `helyett ${substitute ?? "helyettes"} ${played ? "játszott" : "játszik"}`;

// "Kiss Anna helyett helyettes játszik" / "játszott".
export const absenceLine = (name: string, played: boolean, substitute?: string | null) => `${name} ${absenceTail(played, substitute)}`;

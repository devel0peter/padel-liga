import { describe, expect, it } from "vitest";

import { DELETED_NAME } from "./account-deletion";
import { GIVEN_NAME_COUNT, isListedGivenName } from "./given-names";
import {
  asksSurname,
  greeting,
  initial,
  isGivenName,
  nameInfo,
  nameParts,
  surnameByRules,
  teamLabel,
  teamLabeler,
  teamLabels,
} from "./names";

describe("the given-name list (HUN-REN NYTI, 2025-07-31)", () => {
  it("holds both lists: 2,012 male and 2,691 female names", () => {
    expect(GIVEN_NAME_COUNT).toBe(2012 + 2691);
  });

  it("knows given names, not surnames", () => {
    expect(["anna", "bence", "lilla", "farkas", "zsófia", "györgy"].every(isListedGivenName)).toBe(true);
    expect(["kovács", "nagy", "papp", "szabó", "tóth"].some(isListedGivenName)).toBe(false);
  });
});

describe("isGivenName", () => {
  it("ignores case and Unicode normalisation", () => {
    expect(isGivenName("ANNA")).toBe(true);
    expect(isGivenName("Zsófia")).toBe(true); // ó as o + combining acute
  });

  it("takes a hyphenated word as a given name only when every part is one", () => {
    expect(isGivenName("Anna-Mária")).toBe(true);
    expect(isGivenName("Kiss-Nagy")).toBe(false);
    expect(isGivenName("Farkas-Kovács")).toBe(false);
  });
});

describe("nameParts", () => {
  it("splits on spaces and drops leading titles, with or without the dot", () => {
    expect(nameParts("  dr. Kovács   Anna ")).toEqual(["Kovács", "Anna"]);
    expect(nameParts("Ifj. Nagy Béla")).toEqual(["Nagy", "Béla"]);
    expect(nameParts("id. Szabó Péter")).toEqual(["Szabó", "Péter"]);
    expect(nameParts("özv. Tóth Józsefné")).toEqual(["Tóth", "Józsefné"]);
    expect(nameParts("PROF. dr. Kiss Ádám")).toEqual(["Kiss", "Ádám"]);
    expect(nameParts("Dr Kovács Anna")).toEqual(["Kovács", "Anna"]);
  });

  it("keeps a hyphenated surname whole", () => {
    expect(nameParts("Kiss-Nagy Eszter")).toEqual(["Kiss-Nagy", "Eszter"]);
  });

  it("keeps a lone title rather than leaving nothing", () => {
    expect(nameParts("dr.")).toEqual(["dr."]);
    expect(nameParts("")).toEqual([]);
  });
});

describe("surnameByRules (#419, requirement 1)", () => {
  it("one word: unsure, the surname is that word", () => {
    expect(surnameByRules("Kovács")).toEqual({ surname: "Kovács", index: 0, sure: false });
    expect(surnameByRules("Anna")).toEqual({ surname: "Anna", index: 0, sure: false });
  });

  it("an empty name has none", () => {
    expect(surnameByRules("  ")).toEqual({ surname: "", index: -1, sure: false });
  });

  it("drops dr., ifj., id., özv. and prof. first", () => {
    expect(surnameByRules("dr. Kovács Anna")).toEqual({ surname: "Kovács", index: 0, sure: true });
    expect(surnameByRules("ifj. Anna Kovács").surname).toBe("Kovács");
    expect(surnameByRules("prof. Kovács").sure).toBe(false);
  });

  it("married form: a last word in -né that is not a given name means the first word, sure", () => {
    expect(surnameByRules("Kovács Péterné")).toEqual({ surname: "Kovács", index: 0, sure: true });
    expect(surnameByRules("özv. Tóth Józsefné")).toEqual({ surname: "Tóth", index: 0, sure: true });
  });

  it("a given name in -né is no married form", () => {
    // René and Dafné are on the lists: "Kovács René" is plain Hungarian order.
    expect(surnameByRules("Kovács René")).toEqual({ surname: "Kovács", index: 0, sure: true });
    expect(surnameByRules("Dafné Kovács")).toEqual({ surname: "Kovács", index: 1, sure: true });
  });

  it("Hungarian order: the first word is no given name and a later one is", () => {
    expect(surnameByRules("Kovács Anna")).toEqual({ surname: "Kovács", index: 0, sure: true });
    expect(surnameByRules("Kovács Anna Mária")).toEqual({ surname: "Kovács", index: 0, sure: true });
    expect(surnameByRules("Kovácsné Szabó Anna")).toEqual({ surname: "Kovácsné", index: 0, sure: true });
  });

  it("western order: the first word is a given name and the last is not", () => {
    expect(surnameByRules("Anna Kovács")).toEqual({ surname: "Kovács", index: 1, sure: true });
    expect(surnameByRules("Anna Mária Kovács")).toEqual({ surname: "Kovács", index: 2, sure: true });
  });

  it("both are given names: unsure, the first word", () => {
    expect(surnameByRules("Farkas Lilla")).toEqual({ surname: "Farkas", index: 0, sure: false });
    expect(surnameByRules("Lilla Farkas")).toEqual({ surname: "Lilla", index: 0, sure: false });
  });

  it("neither is a given name: unsure, the first word", () => {
    expect(surnameByRules("Kovács Szabó")).toEqual({ surname: "Kovács", index: 0, sure: false });
    expect(surnameByRules("John Smith")).toEqual({ surname: "John", index: 0, sure: false });
  });

  it("a hyphenated surname stays whole, in either order", () => {
    expect(surnameByRules("Kiss-Nagy Eszter")).toEqual({ surname: "Kiss-Nagy", index: 0, sure: true });
    expect(surnameByRules("Eszter Kiss-Nagy")).toEqual({ surname: "Kiss-Nagy", index: 1, sure: true });
  });

  it("ignores case and Unicode normalisation", () => {
    expect(surnameByRules("KOVÁCS ANNA")).toEqual({ surname: "KOVÁCS", index: 0, sure: true });
    // Decomposed "á" (a + combining acute) comes back composed.
    expect(surnameByRules("Kovács Anna").surname).toBe("Kovács");
  });
});

describe("nameInfo: the player's pick (#419, requirement 2)", () => {
  it("without a pick, the rules decide", () => {
    expect(nameInfo({ name: "Farkas Lilla" })).toEqual({
      parts: ["Farkas", "Lilla"],
      surname: "Farkas",
      given: "Lilla",
      sure: false,
      confirmed: false,
    });
  });

  it("a pick among the name's parts wins, whatever its case", () => {
    expect(nameInfo({ name: "Farkas Lilla", surname: "lilla" })).toMatchObject({ surname: "Lilla", given: "Farkas", confirmed: true });
    expect(nameInfo({ name: "Farkas Lilla", surname: "Farkas" })).toMatchObject({ surname: "Farkas", given: "Lilla", confirmed: true });
    expect(nameInfo({ name: "Kovács Anna", surname: "Anna" })).toMatchObject({ surname: "Anna", given: "Kovács", sure: true, confirmed: true });
  });

  it("ignores a pick that is no longer a part of the name", () => {
    expect(nameInfo({ name: "Papp Lilla", surname: "Farkas" })).toMatchObject({ surname: "Papp", confirmed: false, sure: true });
  });

  it("the given name: a listed one first, never the -né word", () => {
    expect(nameInfo({ name: "Kovácsné Szabó Anna" }).given).toBe("Anna");
    expect(nameInfo({ name: "Kovács Péterné" }).given).toBeNull();
    expect(nameInfo({ name: "Anna Mária Kovács" }).given).toBe("Anna");
    expect(nameInfo({ name: "Kovács" }).given).toBeNull();
    expect(nameInfo({ name: "Kovács Szabó" }).given).toBe("Szabó");
  });

  it("an empty name shows as Névtelen", () => {
    expect(nameInfo({ name: "" })).toEqual({ parts: [], surname: "Névtelen", given: null, sure: false, confirmed: false });
  });
});

describe("asksSurname (#419, requirement 7)", () => {
  it("asks an unsure, unconfirmed player with more than one part", () => {
    expect(asksSurname({ name: "Farkas Lilla" })).toBe(true);
    expect(asksSurname({ name: "Kovács Szabó", surname: null })).toBe(true);
  });

  it("never asks a sure name", () => {
    expect(asksSurname({ name: "Kovács Anna" })).toBe(false);
    expect(asksSurname({ name: "Anna Kovács" })).toBe(false);
    expect(asksSurname({ name: "Kovács Péterné" })).toBe(false);
  });

  it("asks once: an answer (either part) ends it", () => {
    expect(asksSurname({ name: "Farkas Lilla", surname: "Farkas" })).toBe(false);
    expect(asksSurname({ name: "Farkas Lilla", surname: "Lilla" })).toBe(false);
  });

  it("asks again once the name changed and the pick no longer fits", () => {
    expect(asksSurname({ name: "Farkas Ilona", surname: "Lilla" })).toBe(true);
  });

  it("a one-word or empty name has nothing to pick", () => {
    expect(asksSurname({ name: "Kovács" })).toBe(false);
    expect(asksSurname({ name: "" })).toBe(false);
  });
});

describe("greeting (#419, requirement 5)", () => {
  it("uses the given name when the name is sure", () => {
    expect(greeting({ name: "Kovács Anna" })).toBe("Szia, Anna!");
    expect(greeting({ name: "Anna Kovács" })).toBe("Szia, Anna!");
    expect(greeting({ name: "dr. Kovács Anna Mária" })).toBe("Szia, Anna!");
  });

  it("uses the given name once the player confirmed", () => {
    expect(greeting({ name: "Farkas Lilla", surname: "Farkas" })).toBe("Szia, Lilla!");
    expect(greeting({ name: "Farkas Lilla", surname: "Lilla" })).toBe("Szia, Farkas!");
  });

  it("falls back to Szia! when unsure and unconfirmed, or without a given name", () => {
    expect(greeting({ name: "Farkas Lilla" })).toBe("Szia!");
    expect(greeting({ name: "Kovács" })).toBe("Szia!");
    expect(greeting({ name: "Kovács Péterné" })).toBe("Szia!");
    expect(greeting({ name: "" })).toBe("Szia!");
  });
});

describe("initial", () => {
  it("takes the first letter, or a Hungarian double letter", () => {
    expect(["Béla", "anna", "Zsófia", "György", "Csaba", "Szilvia", "Dzsenifer", "Nándor", "Ádám", "Dávid"].map(initial)).toEqual([
      "B.",
      "A.",
      "Zs.",
      "Gy.",
      "Cs.",
      "Sz.",
      "Dzs.",
      "N.",
      "Á.",
      "D.",
    ]);
  });
});

describe("team labels (#419, requirement 3)", () => {
  const anna = { name: "Kovács Anna" };
  const bence = { name: "Nagy Bence" };
  const dora = { name: "Nagy Dóra" };
  const lilla = { name: "Farkas Lilla" };
  const adam = { name: "Papp Ádám" };

  it("shows the two surnames: Kovács / Nagy", () => {
    expect(teamLabel([anna, bence])).toBe("Kovács / Nagy");
    expect(teamLabel([{ name: "Anna Kovács" }, { name: "dr. Nagy Bence" }])).toBe("Kovács / Nagy");
  });

  it("an unsure, unconfirmed name still shows its first word", () => {
    expect(teamLabel([lilla, adam])).toBe("Farkas / Papp");
  });

  it("follows the player's pick", () => {
    expect(teamLabel([{ name: "Farkas Lilla", surname: "Lilla" }, adam])).toBe("Lilla / Papp");
  });

  it("two players of one pair sharing a surname both get their initial", () => {
    expect(teamLabel([bence, dora])).toBe("Nagy B. / Nagy D.");
  });

  it("players of different pairs on one screen sharing a surname both get their initial", () => {
    expect(teamLabels([[anna, bence], [lilla, dora], [adam, { name: "Tóth Gábor" }]])).toEqual([
      "Kovács / Nagy B.",
      "Farkas / Nagy D.",
      "Papp / Tóth",
    ]);
  });

  it("applies only to the players given as shown together", () => {
    const label = teamLabeler([anna, bence, lilla, adam]);
    expect(label([anna, bence])).toBe("Kovács / Nagy");
    expect(teamLabeler([anna, bence, dora])([anna, bence])).toBe("Kovács / Nagy B.");
  });

  it("one player shown twice is no clash", () => {
    expect(teamLabels([[anna, bence], [{ name: "Nagy Bence" }, lilla]])).toEqual(["Kovács / Nagy", "Nagy / Farkas"]);
  });

  it("the same initial twice: the whole given name", () => {
    expect(teamLabel([bence, { name: "Nagy Béla" }])).toBe("Nagy Bence / Nagy Béla");
  });

  it("uses Hungarian double letters and the confirmed surname for the clash", () => {
    expect(teamLabel([{ name: "Szabó Zsófia" }, { name: "Gyula Szabó" }])).toBe("Szabó Zs. / Szabó Gy.");
    expect(teamLabel([{ name: "Farkas Lilla", surname: "Lilla" }, { name: "Lilla Papp" }])).toBe("Lilla / Papp");
  });

  it("a married form without a given name takes the rest of the name for the initial", () => {
    expect(teamLabel([{ name: "Kovács Péterné" }, anna])).toBe("Kovács P. / Kovács A.");
  });

  it("a one-word name gets no initial", () => {
    expect(teamLabel([{ name: "Nagy" }, bence])).toBe("Nagy / Nagy B.");
  });

  it("a deleted account stays Törölt játékos, an empty name Névtelen", () => {
    expect(teamLabel([{ name: DELETED_NAME }, bence])).toBe("Törölt játékos / Nagy");
    expect(teamLabels([[{ name: DELETED_NAME }, bence], [{ name: DELETED_NAME }, anna]])).toEqual([
      "Törölt játékos / Nagy",
      "Törölt játékos / Kovács",
    ]);
    expect(teamLabel([{ name: "" }, bence])).toBe("Névtelen / Nagy");
  });
});

import { describe, expect, it } from "vitest";

import { DELETED_NAME } from "./account-deletion";
import { badgeInitials, fullName, greeting, initial, teamLabel, teamLabeler, teamLabels } from "./names";

// A player as the pages hand one in: the full name and its two parts.
const p = (surname: string, firstName: string, id?: string) => ({ id, name: fullName(surname, firstName), surname, firstName });

describe("fullName", () => {
  it("is the surname, a space and the first name", () => {
    expect(fullName("Kovács", "Anna")).toBe("Kovács Anna");
    expect(fullName("Kiss-Nagy", "Anna Mária")).toBe("Kiss-Nagy Anna Mária");
  });
});

describe("greeting (#419)", () => {
  it("uses the first name when there is one", () => {
    expect(greeting("Anna")).toBe("Szia, Anna!");
    expect(greeting(" Anna Mária ")).toBe("Szia, Anna Mária!");
  });

  it("falls back to Szia! without one", () => {
    expect(greeting(null)).toBe("Szia!");
    expect(greeting(undefined)).toBe("Szia!");
    expect(greeting("  ")).toBe("Szia!");
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

describe("team labels (#419)", () => {
  const anna = p("Kovács", "Anna");
  const bence = p("Nagy", "Bence");
  const dora = p("Nagy", "Dóra");
  const lilla = p("Farkas", "Lilla");
  const adam = p("Papp", "Ádám");

  it("shows the two surnames: Kovács / Nagy", () => {
    expect(teamLabel([anna, bence])).toBe("Kovács / Nagy");
    expect(teamLabel([p("Kiss-Nagy", "Eszter"), lilla])).toBe("Kiss-Nagy / Farkas");
  });

  it("a player without a surname shows the full name", () => {
    expect(teamLabel([{ name: "Farkas Lilla" }, adam])).toBe("Farkas Lilla / Papp");
    expect(teamLabel([{ name: "Ottó", surname: null, firstName: null }, adam])).toBe("Ottó / Papp");
    expect(teamLabel([{ name: "Ottó", surname: "  " }, adam])).toBe("Ottó / Papp");
  });

  it("two players of one pair sharing a surname both get their initial", () => {
    expect(teamLabel([bence, dora])).toBe("Nagy B. / Nagy D.");
  });

  it("players of different pairs on one screen sharing a surname both get their initial", () => {
    expect(teamLabels([[anna, bence], [lilla, dora], [adam, p("Tóth", "Gábor")]])).toEqual(["Kovács / Nagy B.", "Farkas / Nagy D.", "Papp / Tóth"]);
  });

  it("compares surnames whatever their case or Unicode form", () => {
    expect(teamLabel([p("Kovács", "Anna"), p("KOVÁCS", "Béla")])).toBe("Kovács A. / KOVÁCS B.");
  });

  it("applies only to the players given as shown together", () => {
    expect(teamLabeler([anna, bence, lilla, adam])([anna, bence])).toBe("Kovács / Nagy");
    expect(teamLabeler([anna, bence, dora])([anna, bence])).toBe("Kovács / Nagy B.");
  });

  it("only surnames clash: a full name shown for a missing surname changes nothing", () => {
    expect(teamLabel([{ name: "Nagy Szabó" }, bence])).toBe("Nagy Szabó / Nagy");
  });

  it("one player shown twice is no clash, by id or by name", () => {
    expect(teamLabels([[anna, bence], [p("Nagy", "Bence"), lilla]])).toEqual(["Kovács / Nagy", "Nagy / Farkas"]);
    expect(teamLabels([[anna, p("Nagy", "Bence", "b")], [p("Nagy", "Bence", "b"), lilla]])).toEqual(["Kovács / Nagy", "Nagy / Farkas"]);
  });

  it("two different accounts with the same name are two players", () => {
    expect(teamLabels([[anna, p("Nagy", "Bence", "1")], [adam, p("Nagy", "Bence", "2")]])).toEqual(["Kovács / Nagy Bence", "Papp / Nagy Bence"]);
  });

  it("the same initial twice: the whole first name", () => {
    expect(teamLabel([bence, p("Nagy", "Béla")])).toBe("Nagy Bence / Nagy Béla");
  });

  it("uses Hungarian double letters", () => {
    expect(teamLabel([p("Szabó", "Zsófia"), p("Szabó", "Gyula")])).toBe("Szabó Zs. / Szabó Gy.");
  });

  it("a shared surname without a first name gets no initial", () => {
    expect(teamLabel([{ name: "Nagy", surname: "Nagy", firstName: null }, bence])).toBe("Nagy / Nagy B.");
  });

  it("a deleted account stays Törölt játékos, an empty name Névtelen", () => {
    expect(teamLabel([{ name: DELETED_NAME, surname: null }, bence])).toBe("Törölt játékos / Nagy");
    expect(teamLabel([{ name: DELETED_NAME, surname: "Törölt" }, bence])).toBe("Törölt játékos / Nagy");
    expect(teamLabels([[{ name: DELETED_NAME }, bence], [{ name: DELETED_NAME }, anna]])).toEqual(["Törölt játékos / Nagy", "Törölt játékos / Kovács"]);
    expect(teamLabel([{ name: "" }, bence])).toBe("Névtelen / Nagy");
  });
});

describe("badgeInitials", () => {
  it("takes the surname's and the first name's initial, double letters whole", () => {
    expect(badgeInitials({ name: "Kovács Anna", surname: "Kovács", firstName: "Anna" })).toBe("KA");
    expect(badgeInitials({ name: "Szabó Eszter", surname: "Szabó", firstName: "Eszter" })).toBe("SzE");
    expect(badgeInitials({ name: "Nagy", surname: "Nagy", firstName: null })).toBe("N");
  });

  it("falls back to the full name's first and last word", () => {
    expect(badgeInitials({ name: "Tóth Gergő" })).toBe("TG");
    expect(badgeInitials({ name: "Kiss Anna Mária" })).toBe("KM");
    expect(badgeInitials({ name: "zsolt" })).toBe("Zs");
    expect(badgeInitials({ name: "  " })).toBe("?");
  });
});

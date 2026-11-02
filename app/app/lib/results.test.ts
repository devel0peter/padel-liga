import { budapestTime, validateScore, type MatchScore } from "@padel-liga/rules";
import { describe, expect, it } from "vitest";

import {
  autoAcceptLine,
  decisionText,
  neutralDecisionText,
  neutralOutcomeText,
  outcomeText,
  parseOutcome,
  parseScore,
  resultEventText,
  resultStatusView,
  resultTodo,
  scoreText,
  winnerOf,
} from "./results";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

const SPLIT: MatchScore = { sets: [[4, 1], [2, 4]], superTieBreak: [10, 8] };
const T = budapestTime("2026-11-12", 20, 0);

describe("parseScore (#28: two integers per set before validateScore)", () => {
  const filled = { "set1-us": "4", "set1-them": "1", "set2-us": "2", "set2-them": "4", "stb-us": "10", "stb-them": "8" };

  it("reads the player's side first and turns it into the match's a/b order", () => {
    expect(parseScore(form(filled), "a")).toEqual(SPLIT);
    expect(parseScore(form(filled), "b")).toEqual({ sets: [[1, 4], [4, 2]], superTieBreak: [8, 10] });
  });

  it("an empty super tie-break means there was none", () => {
    expect(parseScore(form({ ...filled, "stb-us": " ", "stb-them": "" }), "a")).toEqual({ sets: [[4, 1], [2, 4]] });
  });

  it("anything but a whole number is NaN, so the engine names the field", () => {
    const s = parseScore(form({ ...filled, "set1-us": "4.5", "set2-them": "", "stb-us": "", "stb-them": "x" }), "a");
    expect(s.sets[0]![0]).toBeNaN();
    expect(s.sets[1]![1]).toBeNaN();
    expect(s.superTieBreak![1]).toBeNaN();
    const v = validateScore(s);
    expect(v.ok ? [] : v.errors.map((e) => e.message)).toEqual([
      "1. szett: a játékok száma 0 vagy pozitív egész szám.",
      "2. szett: a játékok száma 0 vagy pozitív egész szám.",
    ]);
  });

  it("refuses negative and long numbers", () => {
    const s = parseScore(form({ ...filled, "set1-us": "-4", "set1-them": "100" }), "a");
    expect(s.sets[0]![0]).toBeNaN();
    expect(s.sets[0]![1]).toBeNaN();
  });
});

describe("score and outcome texts (#28, #29)", () => {
  it("own games first", () => {
    expect(scoreText(SPLIT, "a")).toBe("4:1, 2:4, szuper tie-break 10:8");
    expect(scoreText(SPLIT, "b")).toBe("1:4, 4:2, szuper tie-break 8:10");
    expect(scoreText({ sets: [[4, 2], [5, 4]] }, "b")).toBe("2:4, 4:5");
  });

  it("the winner", () => {
    expect(winnerOf({ kind: "played", score: SPLIT })).toBe("a");
    expect(winnerOf({ kind: "played", score: { sets: [[1, 4], [3, 5]] } })).toBe("b");
    expect(winnerOf({ kind: "played", score: { sets: [[4, 1], [1, 4]], superTieBreak: [9, 11] } })).toBe("b");
    expect(winnerOf({ kind: "walkover", winner: "b" })).toBe("b");
    expect(winnerOf({ kind: "unplayed" })).toBeNull();
  });

  it("every outcome from each side", () => {
    expect(outcomeText({ kind: "played", score: SPLIT }, "a")).toBe("4:1, 2:4, szuper tie-break 10:8 (nyertetek)");
    expect(outcomeText({ kind: "played", score: SPLIT }, "b")).toBe("1:4, 4:2, szuper tie-break 8:10 (kikaptatok)");
    expect(outcomeText({ kind: "walkover", winner: "a" }, "a")).toBe("Játék nélküli győzelem nektek (4:0, 4:0)");
    expect(outcomeText({ kind: "walkover", winner: "a" }, "b")).toBe("Játék nélküli vereség (0:4, 0:4)");
    expect(outcomeText({ kind: "both-inactive" }, "a")).toBe("Mindkét pár vereséget kap (0:4, 0:4)");
    expect(outcomeText({ kind: "unplayed" }, "b")).toBe("Elmaradt: nem számít a tabellába");
  });

  it("for the organizer, with the pairs' names", () => {
    const names = { a: "Anna – Béla", b: "Cili – Dani" };
    expect(neutralOutcomeText({ kind: "played", score: SPLIT }, names)).toBe("4:1, 2:4, szuper tie-break 10:8 (nyert: Anna – Béla)");
    expect(neutralOutcomeText({ kind: "walkover", winner: "b" }, names)).toBe("Játék nélküli győzelem: Cili – Dani (4:0, 4:0)");
    expect(neutralOutcomeText({ kind: "unplayed" }, names)).toBe("Elmaradt: nem számít a tabellába");
  });
});

describe("parseOutcome (#29)", () => {
  it("each choice; the score fields in the match's a/b order", () => {
    expect(parseOutcome(form({ outcome: "played", "set1-us": "1", "set1-them": "4", "set2-us": "3", "set2-them": "5" }))).toEqual({
      kind: "played",
      score: { sets: [[1, 4], [3, 5]] },
    });
    expect(parseOutcome(form({ outcome: "walkover-a" }))).toEqual({ kind: "walkover", winner: "a" });
    expect(parseOutcome(form({ outcome: "walkover-b" }))).toEqual({ kind: "walkover", winner: "b" });
    expect(parseOutcome(form({ outcome: "both-inactive" }))).toEqual({ kind: "both-inactive" });
    expect(parseOutcome(form({ outcome: "unplayed" }))).toEqual({ kind: "unplayed" });
    expect(parseOutcome(form({ outcome: "nyert" }))).toBeNull();
    expect(parseOutcome(form({}))).toBeNull();
  });
});

describe("status, Teendő and log lines (#28)", () => {
  const recorded = { status: "recorded", by: "a", score: SPLIT, at: T } as const;

  it("no result: the scheduling status applies", () => {
    expect(resultStatusView({ status: "none" }, "a")).toBeNull();
    expect(resultTodo({ status: "none" }, "a", "X")).toBeNull();
  });

  it("waiting: for the recorder, and for the other pair to confirm", () => {
    expect(resultStatusView(recorded, "a")).toEqual({ label: "Rögzítettétek: 4:1, 2:4, szuper tie-break 10:8, a másik pár megerősítésére vár", tone: "waiting" });
    expect(resultStatusView(recorded, "b")).toEqual({ label: "Eredmény: 1:4, 4:2, szuper tie-break 8:10, erősítsd meg", tone: "todo" });
    expect(resultTodo(recorded, "a", "Cili – Dani")).toBeNull();
    expect(resultTodo(recorded, "b", "Anna – Béla")).toBe("Erősítsd meg az eredményt (Anna – Béla)");
  });

  it("disputed and final", () => {
    const disputed = { ...recorded, status: "disputed", counter: null, disputedAt: T } as const;
    expect(resultStatusView(disputed, "b")).toEqual({ label: "Vitatott eredmény, a szervező dönt", tone: "waiting" });
    expect(resultTodo(disputed, "b", "X")).toBeNull();
    expect(resultStatusView({ status: "final", outcome: { kind: "walkover", winner: "b" }, how: "organizer", at: T }, "b")).toEqual({
      label: "Végeredmény: Játék nélküli győzelem nektek (4:0, 4:0)",
      tone: "done",
    });
  });

  it("the auto-accept time", () => {
    expect(autoAcceptLine(T)).toBe("Ha addig nem válaszol senki, nov. 12., csütörtök 20:00 után magától elfogadjuk.");
  });

  it("log lines from the viewer's side", () => {
    expect(resultEventText({ kind: "result_recorded", score: SPLIT }, "b")).toBe("Rögzítette az eredményt: 1:4, 4:2, szuper tie-break 8:10");
    expect(resultEventText({ kind: "result_confirmed" }, "a")).toBe("Megerősítette az eredményt");
    expect(resultEventText({ kind: "result_disputed", score: { sets: [[1, 4], [1, 4]] }, note: null }, "a")).toBe("Vitatta az eredményt, ezt írta be helyette: 1:4, 1:4");
    expect(decisionText({ kind: "auto_accepted", outcome: { kind: "played", score: SPLIT }, reason: null }, "a")).toBe(
      "48 óra után magától elfogadtuk az eredményt",
    );
    expect(decisionText({ kind: "organizer", outcome: { kind: "unplayed" }, reason: "Eső" }, "a")).toBe(
      "A szervező döntött: Elmaradt: nem számít a tabellába. Indoklás: Eső",
    );
  });
});

describe("neutralDecisionText (#29)", () => {
  it("names the pairs; the auto-accept has no reason", () => {
    const names = { a: "Anna – Béla", b: "Cili – Dani" };
    expect(neutralDecisionText({ kind: "organizer", outcome: { kind: "walkover", winner: "a" }, reason: "Nem jöttek el." }, names)).toBe(
      "Döntés: Játék nélküli győzelem: Anna – Béla (4:0, 4:0). Indoklás: Nem jöttek el.",
    );
    expect(neutralDecisionText({ kind: "auto_accepted", outcome: { kind: "played", score: SPLIT }, reason: null }, names)).toBe(
      "48 óra után magától elfogadtuk az eredményt",
    );
  });
});

import { describe, expect, it } from "vitest";

import { LEAVE_REASONS, movement, originText, previewText, shownPhase, undecidedText, waitingText } from "./round-switch";

describe("movement and originText (#35: the draft shows where each pair comes from)", () => {
  it("tells up, down, stay and new", () => {
    expect(movement({ kind: "continuing", group: 2, place: 1 }, 1)).toBe("up");
    expect(movement({ kind: "continuing", group: 1, place: 4 }, 2)).toBe("down");
    expect(movement({ kind: "continuing", group: 2, place: 2 }, 2)).toBe("stay");
    expect(movement({ kind: "new" }, 3)).toBe("new");
  });

  it("names the group and place, or a new pair", () => {
    expect(originText({ kind: "continuing", group: 3, place: 1 })).toBe("3. csoport, 1. hely");
    expect(originText({ kind: "new" })).toBe("Új pár");
  });

  it("has a Hungarian reason for every leaver", () => {
    expect(Object.keys(LEAVE_REASONS).sort()).toEqual(["dissolved", "strikes", "taken_out", "withdrawn"]);
  });
});

describe("waitingText", () => {
  it("says when the draft comes, with the right article", () => {
    expect(waitingText("running", 1)).toBe("A tervezet az 1. kör határideje után, hétfőn reggel készül el.");
    expect(waitingText("resolving", 1)).toMatch(/^Az 1\. kör le nem játszott meccseit/);
    expect(waitingText("resolving", 2)).toMatch(/^A 2\. kör le nem játszott meccseit/);
  });
});

describe("shownPhase (#35: which round Csoportok shows)", () => {
  const d = (iso: string) => new Date(iso);
  const phases = [
    { number: 1, deadline: d("2026-11-29T22:59:00Z") },
    { number: 2, deadline: d("2026-12-20T22:59:00Z") },
  ];
  const during = d("2026-11-20T10:00:00Z");
  const after = d("2026-11-30T06:00:00Z");

  it("shows round 1 without groups", () => {
    expect(shownPhase(phases, [], null, after)).toBe(1);
  });

  it("shows the newest round with groups while it runs, the next one after its deadline", () => {
    const one = [{ phase: 1, published: true }];
    expect(shownPhase(phases, one, null, during)).toBe(1);
    expect(shownPhase(phases, one, null, after)).toBe(2);
    expect(shownPhase(phases, [{ phase: 1, published: false }], null, after)).toBe(1);
    expect(shownPhase(phases, [...one, { phase: 2, published: false }], null, after)).toBe(2);
  });

  it("stays on the last round of the season", () => {
    expect(shownPhase(phases, [{ phase: 2, published: true }], null, d("2026-12-21T06:00:00Z"))).toBe(2);
  });

  it("follows the round asked for, if the season has it", () => {
    expect(shownPhase(phases, [{ phase: 1, published: true }], 1, after)).toBe(1);
    expect(shownPhase(phases, [{ phase: 1, published: true }], 7, after)).toBe(2);
  });
});

describe("the next round's preview wording (#363)", () => {
  it("names both rounds and says it is provisional", () => {
    expect(previewText(2, 1)).toBe(
      "A 2. kör csoportjai, ha az 1. kör most érne véget: a le nem játszott meccsek azzal az eredménnyel számítanak, amit most a határidő adna nekik. Minden eredménnyel változik a határidőig; az igazi tervezet a határidő utáni reggel készül el.",
    );
    expect(previewText(6, 5).startsWith("A 6. kör csoportjai, ha az 5. kör")).toBe(true);
  });

  it("counts the undecided matches", () => {
    expect(undecidedText(0)).toBe("Minden meccs eldőlt.");
    expect(undecidedText(7)).toBe("7 meccs még nem dőlt el, ezek eredménye még változtathat rajta.");
  });
});

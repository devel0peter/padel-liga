import { describe, expect, it } from "vitest";

import { pairError, soloPairs, waitingSolos } from "./solo-pairing";
import type { SignupRow } from "./signups-admin";

type Row = Pick<SignupRow, "id" | "city" | "mode" | "status" | "pairedWith" | "level" | "createdAt">;

function row(over: Partial<Row>): Row {
  return {
    id: 1,
    city: "gyor",
    mode: "solo",
    status: "new",
    pairedWith: null,
    level: "kozephalado",
    createdAt: new Date("2026-10-05T10:00:00Z"),
    ...over,
  };
}

describe("waitingSolos", () => {
  it("lists only unpaired solos of the city who haven't withdrawn", () => {
    const rows = [
      row({ id: 1 }),
      row({ id: 2, mode: "pair" }),
      row({ id: 3, city: "debrecen" }),
      row({ id: 4, status: "withdrawn" }),
      row({ id: 5, pairedWith: 6, status: "paired" }),
      row({ id: 6, pairedWith: 5, status: "paired" }),
      row({ id: 7, status: "contacted" }),
    ];
    expect(waitingSolos(rows, "gyor").map((r) => r.id)).toEqual([1, 7]);
  });

  it("orders by level, then by signup time", () => {
    const rows = [
      row({ id: 1, level: "halado" }),
      row({ id: 2, level: "kezdo", createdAt: new Date("2026-10-06T10:00:00Z") }),
      row({ id: 3, level: "kezdo", createdAt: new Date("2026-10-04T10:00:00Z") }),
      row({ id: 4, level: "versenyzo" }),
    ];
    expect(waitingSolos(rows, "gyor").map((r) => r.id)).toEqual([3, 2, 1, 4]);
  });
});

describe("soloPairs", () => {
  it("lists each pair once", () => {
    const rows = [
      row({ id: 1, pairedWith: 4, status: "paired" }),
      row({ id: 2 }),
      row({ id: 4, pairedWith: 1, status: "paired" }),
    ];
    expect(soloPairs(rows, "gyor").map(([a, b]) => [a.id, b.id])).toEqual([[1, 4]]);
  });

  it("skips a half pair whose partner is gone", () => {
    expect(soloPairs([row({ id: 1, pairedWith: 9 })], "gyor")).toEqual([]);
  });
});

describe("pairError", () => {
  it("allows two waiting solos of the city", () => {
    expect(pairError(row({ id: 1 }), row({ id: 2, level: "halado" }), "gyor")).toBeNull();
  });

  it("rejects missing, identical, paired, withdrawn and out-of-city signups", () => {
    expect(pairError(undefined, row({ id: 2 }), "gyor")).toBe("Nincs ilyen jelentkező.");
    expect(pairError(row({ id: 1 }), row({ id: 1 }), "gyor")).toBe("Két különböző játékost válassz.");
    expect(pairError(row({ id: 1 }), row({ id: 2, mode: "pair" }), "gyor")).toMatch(/egyedül/);
    expect(pairError(row({ id: 1 }), row({ id: 2, city: "debrecen" }), "gyor")).toMatch(/egyedül/);
    expect(pairError(row({ id: 1 }), row({ id: 2, status: "withdrawn" }), "gyor")).toMatch(/Visszalépett/);
    expect(pairError(row({ id: 1 }), row({ id: 2, pairedWith: 3 }), "gyor")).toBe("Valamelyikük már párt kapott.");
  });
});

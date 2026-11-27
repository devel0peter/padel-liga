// Migration 0072 (#419, D182): users get `surname` and `first_name`, filled
// from the full name with plain SQL: before the first space the surname, the
// rest the first name; a one-word name is only a surname. Runs every
// migration before it on a real SQLite, adds rows, then applies 0072.
import { describe, expect, it } from "vitest";

const { applyMigrations, migratedDatabase } = await import("~/test/sqlite");

const MIGRATION = "0072";

describe("migration 0072: the name in two parts (#419, D182)", () => {
  it("splits every name at its first space, nothing smarter", () => {
    const raw = migratedDatabase(MIGRATION);
    const rows: [string, string, number | null][] = [
      ["hu", "Kovács Anna", null],
      ["three", "Kovács Anna Mária", null],
      ["spaces", "  Kiss-Nagy   Eszter  ", null],
      // A western-order name is split the same way: Peter fixes these by hand.
      ["west", "Anna Kovács", null],
      ["one", "Ottó", null],
      ["empty", "", null],
      ["gone", "Törölt játékos", 1],
    ];
    for (const [id, name, deleted] of rows)
      raw.prepare("insert into users (id, email, name, deleted_at) values (?, ?, ?, ?)").run(id, `${id}@x.hu`, name, deleted);

    applyMigrations(raw, (f) => f >= MIGRATION);

    expect(raw.prepare("select id, name, surname, first_name from users order by rowid").all()).toEqual([
      { id: "hu", name: "Kovács Anna", surname: "Kovács", first_name: "Anna" },
      { id: "three", name: "Kovács Anna Mária", surname: "Kovács", first_name: "Anna Mária" },
      { id: "spaces", name: "  Kiss-Nagy   Eszter  ", surname: "Kiss-Nagy", first_name: "Eszter" },
      { id: "west", name: "Anna Kovács", surname: "Anna", first_name: "Kovács" },
      { id: "one", name: "Ottó", surname: "Ottó", first_name: null },
      { id: "empty", name: "", surname: null, first_name: null },
      // An anonymized account keeps no name parts.
      { id: "gone", name: "Törölt játékos", surname: null, first_name: null },
    ]);
  });
});

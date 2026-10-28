// The SQLite test client behaves like D1 for batches (#98): a raw statement
// with bound parameters can't go in db.batch there, so it can't here either.
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { db } = await import("~/db/client.server");
const { cities } = await import("~/db/schema");

beforeEach(() => {
  h.raw = migratedDatabase();
});

describe("batches on the SQLite test client", () => {
  it("refuses a raw statement with parameters, as D1 does", async () => {
    await expect(
      db.batch([db.run(sql`insert into cities (slug, name, listed) values (${"pecs"}, ${"Pécs"}, 1)`), db.select().from(cities)]),
    ).rejects.toThrow(/raw statement with parameters/);
    expect(h.raw.prepare("select count(*) as n from cities where slug = 'pecs'").get().n).toBe(0);
  });

  it("takes a raw statement without parameters, and query builders", async () => {
    await db.batch([db.run(sql`delete from cities where listed = 0`), db.insert(cities).values({ slug: "pecs", name: "Pécs", listed: true })]);
    expect(h.raw.prepare("select count(*) as n from cities where slug = 'pecs'").get().n).toBe(1);
  });
});

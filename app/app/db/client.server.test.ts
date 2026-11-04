// The D1 client counts the run's queries (#183, lib/run-usage.ts) the way D1
// counts them: each statement that runs once, a batch once. A fake binding
// stands in for D1; like the real one, its batch takes only its own
// statements.
import { describe, expect, it, vi } from "vitest";

class FakeStatement {
  constructor(
    readonly sql: string,
    readonly params: unknown[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new FakeStatement(this.sql, params);
  }
  async all() {
    return { results: [{ sql: this.sql, params: this.params }] };
  }
  async run() {
    return { success: true };
  }
  async raw() {
    return [[this.sql]];
  }
  async first() {
    return { sql: this.sql };
  }
}

const fake = {
  prepare: (sql: string) => new FakeStatement(sql),
  batch: async (statements: unknown[]) => {
    for (const s of statements) if (!(s instanceof FakeStatement)) throw new TypeError("not a D1 statement");
    return statements.map(() => ({ success: true }));
  },
};

// No binding at import, as when Cloudflare validates an upload (#234).
const env = vi.hoisted(() => ({ DB: undefined as unknown }));
vi.mock("cloudflare:workers", () => ({ env }));

const { countedDatabase, db } = await import("~/db/client.server");
const { RunBudget } = await import("~/lib/run-usage");
const { sql } = await import("drizzle-orm");
const { emailMessages } = await import("~/db/schema");

describe("countedDatabase (#183)", () => {
  const d1 = countedDatabase(() => fake as unknown as D1Database);

  it("counts each statement that runs, not the ones only prepared or bound", async () => {
    const budget = new RunBudget();
    const st = d1.prepare("select ?").bind(1);
    expect(budget.used().queries).toBe(0);
    expect(await st.all()).toEqual({ results: [{ sql: "select ?", params: [1] }] });
    await st.run();
    await st.raw();
    await st.first();
    expect(budget.used()).toEqual({ queries: 4, calls: 0 });
  });

  it("counts a batch once and hands the binding its own statements", async () => {
    const budget = new RunBudget();
    const out = await d1.batch([d1.prepare("insert 1").bind(1), d1.prepare("insert 2"), d1.prepare("insert 3").bind(3)]);
    expect(out).toHaveLength(3);
    expect(budget.used().queries).toBe(1);
  });
});

describe("db (#234)", () => {
  it("imports without a binding and reads it only when a query runs", async () => {
    expect(db).toBeDefined();
    await expect(db.run(sql`select 1`)).rejects.toThrow();
    env.DB = fake;
    const budget = new RunBudget();
    await db.run(sql`select 1`);
    await db.batch([db.delete(emailMessages), db.delete(emailMessages)]);
    expect(budget.used().queries).toBe(2);
  });
});

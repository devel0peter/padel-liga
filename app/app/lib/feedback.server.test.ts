// feedback.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): storing with context and the rate limits (#239), the
// form's submit with the visitor bot check (#240), the Admin's list and the
// done state (#241). Nothing is sent.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, bot: "ok" as "ok" | "missing" | "rejected", botCalls: 0 }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/turnstile.server", () => ({
  verifyTurnstile: async () => {
    h.botCalls++;
    return h.bot;
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const F = await import("~/lib/feedback.server");
const { ERRORS } = await import("~/lib/feedback");
const { turnstileError } = await import("~/lib/turnstile");

const NOW = new Date("2026-11-12T18:00:00Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

const rows = () => h.raw.prepare("select * from feedback order by id").all();
const audit = () => h.raw.prepare("select actor_id, action, target from audit_log order by id").all();

function addUser(id: string, name: string) {
  h.raw
    .prepare("insert into users (id, email, name, phone, created_at) values (?, ?, ?, ?, ?)")
    .run(id, `${id}@example.test`, name, "+36301234567", Math.floor(NOW.getTime() / 1000));
}

const base = { page: "/home", device: "desktop" as const, browser: "Chrome", appVersion: "abc1234" };
const store = (userId: string | null, at: Date, kind: "bug" | "idea" | "other" | "rating" = "bug") =>
  F.storeFeedback({ ...base, kind, message: "Valami", rating: kind === "rating" ? 4 : null, userId }, at);

function form(fields: Record<string, string>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}
const request = (ua = IPHONE) =>
  new Request("https://padelparbaj.hu/feedback?from=%2Fmatches%2F12", {
    method: "POST",
    headers: { "User-Agent": ua, "CF-Connecting-IP": "203.0.113.9" },
  });

beforeEach(() => {
  h.raw = migratedDatabase();
  h.bot = "ok";
  h.botCalls = 0;
  addUser("u1", "Kiss Anna");
  addUser("u2", "Nagy Béla");
  addUser("adm", "Admin");
});

describe("storing feedback (#239)", () => {
  it("stores each type with its context; only a rating has stars", async () => {
    for (const kind of ["bug", "idea", "other", "rating"] as const) expect(await store("u1", NOW, kind)).toBeTypeOf("number");
    const stored = rows();
    expect(stored.map((r: any) => [r.kind, r.rating])).toEqual([
      ["bug", null],
      ["idea", null],
      ["other", null],
      ["rating", 4],
    ]);
    expect(stored[0]).toMatchObject({
      message: "Valami",
      page: "/home",
      device: "desktop",
      browser: "Chrome",
      app_version: "abc1234",
      user_id: "u1",
      created_at: Math.floor(NOW.getTime() / 1000),
      done_at: null,
    });
  });

  it("the sixth message within an hour from one account is refused; other accounts and visitors are not affected", async () => {
    for (let i = 0; i < 5; i++) expect(await store("u1", minutes(i * 10))).not.toBeNull();
    expect(await store("u1", minutes(50))).toBeNull();
    expect(await store("u2", minutes(50))).not.toBeNull();
    expect(await store(null, minutes(50))).not.toBeNull();
    expect(rows().filter((r: any) => r.user_id === "u1")).toHaveLength(5);
    // An hour after the first, there is room for one again.
    expect(await store("u1", minutes(61))).not.toBeNull();
  });

  it("the twenty-first message within a day from one account is refused", async () => {
    // 5 every 2 hours: never over the hourly limit.
    for (let i = 0; i < 20; i++) expect(await store("u1", minutes(Math.floor(i / 5) * 120 + (i % 5))), `message ${i + 1}`).not.toBeNull();
    expect(await store("u1", minutes(10 * 60))).toBeNull();
    expect(await store("u2", minutes(10 * 60))).not.toBeNull();
    // A day after the first, there is room again.
    expect(await store("u1", minutes(24 * 60 + 1))).not.toBeNull();
    expect(rows().filter((r: any) => r.user_id === "u1")).toHaveLength(21);
  });

  it("visitors together: the 31st message within an hour is refused, accounts are not affected", async () => {
    for (let i = 0; i < 30; i++) expect(await store(null, minutes(i))).not.toBeNull();
    expect(await store(null, minutes(30))).toBeNull();
    expect(await store("u1", minutes(30))).not.toBeNull();
    expect(rows().filter((r: any) => r.user_id === null)).toHaveLength(30);
    expect(await store(null, minutes(61))).not.toBeNull();
  });

  it("deleting an account deletes its feedback, and leaves the others'", async () => {
    await store("u1", NOW);
    await store("u2", NOW);
    await store(null, NOW);
    h.raw.prepare("delete from users where id = 'u1'").run();
    expect(rows().map((r: any) => r.user_id)).toEqual(["u2", null]);
  });
});

// login-code.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): open sign-up (#113). The login code email is stubbed;
// nothing leaves the process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, codes: [] as { to: string; code: string }[] }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueLoginCode: async (to: string, code: string) => h.codes.push({ to, code }),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const L = await import("~/lib/auth/login-code.server");

const all = (q: string) => h.raw.prepare(q).all();

describe("open sign-up (#113)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.codes = [];
    // Before the original 2 Nov opening, when only invited addresses got in.
    vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z"), toFake: ["Date"] });
  });
  afterEach(() => vi.useRealTimers());

  it("sends a code to an address with no invite, no signup and no account", async () => {
    expect(all("select email from account_invites")).toEqual([]);
    expect(await L.sendLoginCode(" Uj.Jatekos@Example.com ")).toEqual({ ok: true, email: "uj.jatekos@example.com" });
    expect(h.codes.map((c) => c.to)).toEqual(["uj.jatekos@example.com"]);
  });

  it("creates the account when the code is right", async () => {
    await L.sendLoginCode("uj.jatekos@example.com");
    const result = await L.verifyLoginCode("uj.jatekos@example.com", h.codes[0]!.code);
    expect(result.ok).toBe(true);
    const users = all("select id, email, name, consent_at from users");
    expect(users).toEqual([{ id: (result as { userId: string }).userId, email: "uj.jatekos@example.com", name: "", consent_at: null }]);
  });

  it("keeps the code limit: at most 5 per address per hour", async () => {
    for (let i = 0; i < 5; i++) expect((await L.sendLoginCode("uj.jatekos@example.com")).ok).toBe(true);
    expect(await L.sendLoginCode("uj.jatekos@example.com")).toEqual({
      ok: false,
      error: "Túl sok kódot kértél. Próbáld újra egy óra múlva.",
    });
    expect(h.codes).toHaveLength(5);
  });
});

// login-code.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): open sign-up (#113) and what keeps codes to new addresses
// from using up the daily email quota. The login code email is stubbed: it is
// stored like the outbox stores it, nothing leaves the process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, limit: 100, codes: [] as { to: string; code: string }[] }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  dailyLimit: () => h.limit,
  queueLoginCode: async (to: string, code: string) => {
    h.codes.push({ to, code });
    h.raw
      .prepare("insert into email_messages (kind, to_email, subject, created_at) values ('login_code', ?, 'kód', ?)")
      .run(to, Math.floor(Date.now() / 1000));
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const L = await import("~/lib/auth/login-code.server");

const all = (q: string) => h.raw.prepare(q).all();
const run = (q: string, ...args: unknown[]) => h.raw.prepare(q).run(...args);

beforeEach(() => {
  h.raw = migratedDatabase();
  h.codes = [];
  h.limit = 100;
  // Before the original 2 Nov opening, when only invited addresses got in.
  vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z"), toFake: ["Date"] });
});
afterEach(() => vi.useRealTimers());

describe("open sign-up (#113)", () => {
  it("sends a code to an address with no invite, no signup and no account", async () => {
    expect(all("select email from account_invites")).toEqual([]);
    expect(await L.sendLoginCode(" Uj.Jatekos@Example.com ")).toEqual({ ok: true, email: "uj.jatekos@example.com" });
    expect(h.codes.map((c) => c.to)).toEqual(["uj.jatekos@example.com"]);
  });

  it("sends none to a deleted account's placeholder address, but looks the same (#152)", async () => {
    run("insert into users (id, email, name, deleted_at) values ('x', 'deleted-x@deleted.invalid', 'Törölt játékos', 1)");
    expect(await L.sendLoginCode("deleted-x@deleted.invalid")).toEqual({ ok: true, email: "deleted-x@deleted.invalid" });
    expect(h.codes).toEqual([]);
    expect(all("select count(*) as n from email_messages")).toEqual([{ n: 0 }]);
    // As for any skipped address: a code row nobody knows (#123).
    expect(all("select email from login_codes")).toEqual([{ email: "deleted-x@deleted.invalid" }]);
  });

  it("never logs into a deleted account's placeholder, even with the right code (#152)", async () => {
    const email = "deleted-x@deleted.invalid";
    run("insert into users (id, email, name, deleted_at) values ('x', ?, 'Törölt játékos', 1)", email);
    const { sha256Hex } = await import("~/lib/auth/tokens");
    const { CODE_MESSAGES } = await import("~/lib/auth/rules");
    // A code row whose code is known (as if guessed), as login-code.server.ts hashes it.
    run(
      "insert into login_codes (email, code_hash, expires_at, window_start) values (?, ?, ?, ?)",
      email,
      await sha256Hex(`${email}:123456`),
      Math.floor(Date.now() / 1000) + 600,
      Math.floor(Date.now() / 1000),
    );
    expect(await L.verifyLoginCode(email, "123456")).toEqual({ ok: false, error: CODE_MESSAGES.wrong });
    // The same code on a normal address logs in: the hash above is the real one.
    run("update login_codes set email = 'uj@example.com', code_hash = ? where email = ?", await sha256Hex("uj@example.com:123456"), email);
    expect((await L.verifyLoginCode("uj@example.com", "123456")).ok).toBe(true);
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

describe("codes to new addresses (#113)", () => {
  it("sends none to a new address that bounced or complained, but looks the same", async () => {
    run("insert into email_suppressions (email, reason) values ('bounced@example.com', 'bounced'), ('spam@example.com', 'complained')");
    expect(await L.sendLoginCode("bounced@example.com")).toEqual({ ok: true, email: "bounced@example.com" });
    expect(await L.sendLoginCode("spam@example.com")).toEqual({ ok: true, email: "spam@example.com" });
    expect(h.codes).toEqual([]);
    // A code row nobody knows, under the same limits as a sent one (#123).
    expect(all("select email, attempts, sent_in_window from login_codes order by email")).toEqual([
      { email: "bounced@example.com", attempts: 0, sent_in_window: 1 },
      { email: "spam@example.com", attempts: 0, sent_in_window: 1 },
    ]);
    expect(await L.verifyLoginCode("bounced@example.com", "123456")).toEqual({ ok: false, error: "Ez nem jó kód. Nézd meg újra a levelet." });
  });

  it("still sends to a new address that only unsubscribed from bulk mail", async () => {
    run("insert into email_suppressions (email, reason) values ('unsub@example.com', 'unsubscribed')");
    await L.sendLoginCode("unsub@example.com");
    expect(h.codes.map((c) => c.to)).toEqual(["unsub@example.com"]);
  });

  it("always sends to an account, even one whose address bounced", async () => {
    run("insert into users (id, email, name) values ('u1', 'anna@example.com', 'Anna')");
    run("insert into email_suppressions (email, reason) values ('anna@example.com', 'bounced')");
    await L.sendLoginCode("anna@example.com");
    expect(h.codes.map((c) => c.to)).toEqual(["anna@example.com"]);
  });

  it("caps codes to new, uninvited addresses at a quarter of the daily limit", async () => {
    h.limit = 20; // cap 5
    for (let i = 1; i <= 7; i++) await L.sendLoginCode(`bot${i}@example.com`);
    expect(h.codes.map((c) => c.to)).toEqual([1, 2, 3, 4, 5].map((i) => `bot${i}@example.com`));
    // The two past the cap get a code row nobody knows, and no email (#123).
    expect(all("select count(*) as n from login_codes")).toEqual([{ n: 7 }]);
    expect(all("select count(*) as n from email_messages")).toEqual([{ n: 5 }]);
  });

  it("past the cap still sends to accounts and invited addresses", async () => {
    h.limit = 8; // cap 2
    await L.sendLoginCode("bot1@example.com");
    await L.sendLoginCode("bot2@example.com");
    run("insert into users (id, email, name) values ('u1', 'anna@example.com', 'Anna')");
    run("insert into account_invites (email) values ('meghivott@example.com')");
    for (const to of ["bot3@example.com", "anna@example.com", "meghivott@example.com"]) await L.sendLoginCode(to);
    expect(h.codes.map((c) => c.to)).toEqual(["bot1@example.com", "bot2@example.com", "anna@example.com", "meghivott@example.com"]);
  });

  it("counts only the last 24 hours, and not addresses that registered since", async () => {
    h.limit = 8; // cap 2
    await L.sendLoginCode("bot1@example.com");
    await L.sendLoginCode("uj@example.com");
    await L.sendLoginCode("bot3@example.com");
    expect(h.codes).toHaveLength(2);
    // The new player registered: their code no longer counts against the cap.
    run("insert into users (id, email, name) values ('u2', 'uj@example.com', 'Új')");
    await L.sendLoginCode("bot3@example.com");
    expect(h.codes).toHaveLength(3);
    // A day later the earlier codes are out of the window.
    vi.setSystemTime(new Date("2026-10-29T12:00:01Z"));
    await L.sendLoginCode("bot4@example.com");
    await L.sendLoginCode("bot5@example.com");
    expect(h.codes.map((c) => c.to).slice(3)).toEqual(["bot4@example.com", "bot5@example.com"]);
  });
});

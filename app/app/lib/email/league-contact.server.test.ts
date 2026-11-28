import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  raw: null as { exec: (sql: string) => void; prepare: (sql: string) => { all: () => unknown[] } } | null,
  env: {} as Record<string, string>,
  sent: [] as { to: string; fromName?: string; replyTo?: string; subject: string }[],
}));

vi.mock("cloudflare:workers", () => ({ env: h.env, waitUntil: () => {} }));
vi.mock("cloudflare:sockets", () => ({ connect: () => { throw new Error("unused"); } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("./send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async (emails: { to: string; fromName?: string; replyTo?: string; subject: string }[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true as const, id: `m-${i}` }));
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const M = await import("./mime");
const O = await import("./outbox.server");
const L = await import("../leagues.server");

const all = <T = Record<string, unknown>>(sql: string) => h.raw!.prepare(sql).all() as T[];

function freshDb() {
  h.raw = migratedDatabase();
  h.sent = [];
  h.raw.exec(`
    insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('movar', 'Mosonmagyaróvár', 1);
    insert or replace into leagues (id, city, slug, name, contact_name, contact_email) values
      (1, 'gyor', 'gyor', 'Győri liga', 'Péter, Padelpárbaj', 'hello@padelparbaj.hu'),
      (2, 'movar', 'movar', 'Mosonmagyaróvári liga', 'Teszt Szervező', 'szervezo@movar.hu');
    insert into users (id, email, name, platform_role, consent_at) values
      ('o2', 'o2@x.hu', 'Teszt Szervező', 'player', 1000);
  `);
}

describe("per-league contact, RFC 2047 headers, local rules and outbox scoping (#384, #388, #390)", () => {
  beforeEach(freshDb);

  it("encodes Hungarian display names per RFC 2047 and strips CRLF injection", () => {
    const hu = M.formatFromHeader("Teszt Szervező\r\nBcc: evil@x.hu", "hello@padelparbaj.hu");
    expect(hu).not.toContain("\r\nBcc:");
    expect(hu).toMatch(/^=\?UTF-8\?B\?.+\?= <hello@padelparbaj\.hu>$/);

    const asciiComma = M.formatFromHeader("Peter, Padel", "hello@padelparbaj.hu");
    expect(asciiComma).toBe('"Peter, Padel" <hello@padelparbaj.hu>');
  });

  it("delivers league emails with that league's sender name and reply-to, and filters outboxLog by league", async () => {
    await O.queueNewSignupsDaily(["o2@x.hu"], {
      leagueName: "Mosonmagyaróvári liga",
      leagueSlug: "movar",
      counts: { playerJoined: 1, pairFormed: 0, pairEnteredByPhase: [], partnerSearch: 0 },
      waiting: { pairs: 1, singles: 0 },
    }, 2);
    await O.queueLoginCode("o2@x.hu", "123456");

    await O.deliver();
    const movarMail = h.sent.find((e) => e.subject.includes("Mosonmagyaróvári"));
    const loginMail = h.sent.find((e) => e.subject.includes("123456") || e.fromName === undefined);
    expect(movarMail?.fromName).toBe("Teszt Szervező");
    expect(movarMail?.replyTo).toBe("szervezo@movar.hu");
    expect(loginMail?.fromName).toBeUndefined();

    // Outbox scoped to league 2 hides login_code and league 1
    const log2 = await O.outboxLog(2);
    expect(log2.map((r) => r.kind)).toEqual(["new_signups_daily"]);
    expect(await O.outboxLog(1)).toEqual([]);
  });

  it("validates league contact for listed city, logs without values, and saves local rules", async () => {
    expect(await L.updateLeagueContact(2, { name: "", email: "", phone: "" }, "o2")).toMatchObject({ ok: false });
    expect(await L.updateLeagueContact(2, { name: "Új Szervező", email: "uj@movar.hu", phone: "+36301112222" }, "o2")).toEqual({ ok: true });
    const audit = all<{ action: string; detail: string | null }>("select action, detail from audit_log where action = 'league.contact'");
    expect(audit).toHaveLength(1);
    expect(audit[0].detail).toBeNull();

    expect(await L.updateLeagueLocalRules(2, "Helyi klub: Padel Klub\n\nhttps://example.hu", "o2")).toEqual({ ok: true });
    const settings = await L.getLeagueSettings("movar");
    expect(settings?.contactName).toBe("Új Szervező");
    expect(settings?.localRules).toContain("Padel Klub");
  });
});

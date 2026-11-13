// /admin/outbox is for the Admin only (#88), and since #112 only a log: its
// loader refuses a Szervező and a Játékos with 403, with the real session
// lookup on a real SQLite (~/test/sqlite). Email is stubbed; nothing leaves
// the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[], relay: false }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/background.server", () => import("~/test/background"));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => h.relay,
  sendEmails: async (emails: any[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { settleBackground } = await import("~/test/background");
const { createSession } = await import("~/lib/auth/session.server");
const R = await import("~/routes/admin.outbox");

async function cookieFor(id: string, role: "player" | "superadmin", organizes = false) {
  h.raw
    .prepare("insert into users (id, email, name, sex, consent_at, platform_role) values (?, ?, ?, 'female', 1, ?)")
    .run(id, `${id}@x.hu`, id, role);
  if (organizes) h.raw.prepare("insert into league_admins (league_id, user_id) values (1, ?)").run(id);
  return (await createSession(id)).split(";")[0];
}

const get = (cookie: string) => new Request("http://localhost/admin/outbox", { headers: { Cookie: cookie } });
const args = (request: Request) => ({ request, params: {}, context: {} }) as any;

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e: any) {
    return e?.init?.status ?? e?.status ?? -1;
  }
}

describe("/admin/outbox", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    const st = h.raw.prepare(
      "insert into email_messages (kind, to_email, subject, text, status, sent_at, last_error) values (?, ?, 's', 't', ?, ?, ?)",
    );
    st.run("pair_intro", "anna@x.hu", "sent", Math.floor(Date.now() / 1000), null);
    st.run("pair_intro", "bela@x.hu", "pending", null, null);
    st.run("broadcast", "cili@x.hu", "failed", null, "relay: RCPT TO: 550 <cili@x.hu> unknown");
  });

  it("shows the relay warning in production only while the relay isn't configured (#127)", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    vi.stubEnv("DEV", false);
    try {
      h.relay = false;
      expect((await R.loader(args(get(cookie)))).relayWarning).toMatch(/Resenden mennek ki, naponta legfeljebb 100/);
      h.relay = true;
      const withRelay = await R.loader(args(get(cookie)));
      expect(withRelay.relayWarning).toBeNull();
      expect(withRelay.limit).toBe(5000);
      h.relay = false;
      vi.stubEnv("DEV", true);
      expect((await R.loader(args(get(cookie)))).relayWarning).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      h.relay = false;
    }
  });

  it("refuses a Játékos and a Szervező with 403", async () => {
    for (const cookie of [await cookieFor("jatekos", "player"), await cookieFor("szervezo", "player", true)])
      expect(await status(R.loader(args(get(cookie))))).toBe(403);
  });

  it("sends a logged-out visitor to the login page", async () => {
    expect(await status(R.loader(args(get(""))))).toBe(302);
  });

  it("shows the Admin the counts per kind, the newest failure and no address", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    const page = await R.loader(args(get(cookie)));
    expect(page.log.map(({ kind, waiting, sent, failed }) => ({ kind, waiting, sent, failed }))).toEqual([
      { kind: "pair_intro", waiting: 1, sent: 1, failed: 0 },
      { kind: "broadcast", waiting: 0, sent: 0, failed: 1 },
    ]);
    expect(page.log[1].lastError?.reason).toBe("relay: RCPT TO: 550 <[elrejtve]> unknown");
    expect(page.sent).toBe(1);
    expect(JSON.stringify(page)).not.toContain("@x.hu");
    expect(h.sent).toEqual([]);
  });
});

// "Újraküldés" (D150): a kind's failed emails back in the queue, sent after
// the response, with one audit entry. Only the Admin; never a login code.
describe("/admin/outbox Újraküldés", () => {
  const post = (cookie: string, kind: string) => {
    const body = new FormData();
    body.set("kind", kind);
    return new Request("http://localhost/admin/outbox", { method: "POST", body, headers: { Cookie: cookie } });
  };
  const statuses = () => h.raw.prepare("select kind, to_email, status, attempts, last_error from email_messages order by id").all();

  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    const st = h.raw.prepare("insert into email_messages (kind, to_email, subject, html, text, status, attempts, last_error) values (?, ?, 's', ?, ?, ?, ?, ?)");
    st.run("groups_published", "anna@x.hu", "<p>t</p>", "t", "failed", 0, "interrupted while sending; not retried, so it can't go out twice");
    st.run("groups_published", "bela@x.hu", "<p>t</p>", "t", "failed", 5, "relay: 421 try later");
    // Sent: its text is gone, and it stays sent.
    st.run("groups_published", "cili@x.hu", null, null, "sent", 0, null);
    st.run("broadcast", "dora@x.hu", "<p>t</p>", "t", "failed", 1, "relay: 550");
    st.run("login_code", "ede@x.hu", "<p>t</p>", "t", "failed", 1, "relay: 421");
  });

  it("puts one kind's failed emails back in the queue and sends them after the response", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    expect(await R.action(args(post(cookie, "groups_published")))).toEqual({ retried: 2, kind: "groups_published" });
    // The broadcast and the sent one are untouched.
    expect(statuses().slice(0, 4).map((r: any) => r.status)).toEqual(["pending", "pending", "sent", "failed"]);
    await settleBackground();
    expect(h.sent.map((m) => m.to)).toEqual(["anna@x.hu", "bela@x.hu"]);
    expect(statuses().slice(0, 2)).toEqual([
      { kind: "groups_published", to_email: "anna@x.hu", status: "sent", attempts: 0, last_error: null },
      { kind: "groups_published", to_email: "bela@x.hu", status: "sent", attempts: 0, last_error: null },
    ]);
    expect(h.raw.prepare("select actor_id, action, target from audit_log").all()).toEqual([
      { actor_id: "admin", action: "outbox.retry", target: "kind:groups_published" },
    ]);
  });

  it("never resends a login code, nor an unknown kind", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    expect(await status(R.action(args(post(cookie, "login_code"))))).toBe(400);
    expect(await status(R.action(args(post(cookie, "nincs_ilyen"))))).toBe(400);
    await settleBackground();
    expect(h.sent).toEqual([]);
    expect(statuses().find((r: any) => r.kind === "login_code").status).toBe("failed");
  });

  it("with nothing failed of that kind, says so and writes no audit entry", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    h.raw.exec("update email_messages set status = 'sent' where kind = 'broadcast'");
    expect(await R.action(args(post(cookie, "broadcast")))).toEqual({ retried: 0, kind: "broadcast" });
    expect(h.raw.prepare("select count(*) as n from audit_log").get().n).toBe(0);
  });

  it("refuses a Játékos and a Szervező with 403", async () => {
    for (const cookie of [await cookieFor("jatekos", "player"), await cookieFor("szervezo", "player", true)])
      expect(await status(R.action(args(post(cookie, "groups_published"))))).toBe(403);
    expect(statuses()[0].status).toBe("failed");
  });
});

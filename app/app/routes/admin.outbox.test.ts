// /admin/outbox is for the Admin only (#88), and since #112 only a log: its
// loader refuses a Szervező and a Játékos with 403, with the real session
// lookup on a real SQLite (~/test/sqlite). Email is stubbed; nothing leaves
// the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  sendEmails: async (emails: any[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const R = await import("~/routes/admin.outbox");

async function cookieFor(id: string, role: "player" | "superadmin", organizes = false) {
  h.raw
    .prepare("insert into users (id, email, name, consent_at, platform_role) values (?, ?, ?, 1, ?)")
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

  it("refuses a Játékos and a Szervező with 403", async () => {
    for (const cookie of [await cookieFor("jatekos", "player"), await cookieFor("szervezo", "player", true)])
      expect(await status(R.loader(args(get(cookie))))).toBe(403);
  });

  it("sends a logged-out visitor to the login page", async () => {
    expect(await status(R.loader(args(get(""))))).toBe(302);
  });

  it("shows the Admin the counts per kind, the newest failure and no address, and has nothing to send or discard", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    const page = await R.loader(args(get(cookie)));
    expect(page.log.map(({ kind, waiting, sent, failed }) => ({ kind, waiting, sent, failed }))).toEqual([
      { kind: "pair_intro", waiting: 1, sent: 1, failed: 0 },
      { kind: "broadcast", waiting: 0, sent: 0, failed: 1 },
    ]);
    expect(page.log[1].lastError?.reason).toBe("relay: RCPT TO: 550 <[elrejtve]> unknown");
    expect(page.sent).toBe(1);
    expect(JSON.stringify(page)).not.toContain("@x.hu");
    // No Küldés, no Elvetés (#112).
    expect("action" in R).toBe(false);
    expect(h.sent).toEqual([]);
  });
});

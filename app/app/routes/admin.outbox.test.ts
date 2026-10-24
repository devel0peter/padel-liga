// /admin/outbox is for the Admin only (#88): its loader and action refuse a
// Szervező and a Játékos with 403, with the real session lookup on a real
// SQLite (~/test/sqlite). Email is stubbed; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/resend.server", () => ({
  MAX_BATCH: 100,
  sendBatch: async (emails: any[]) => {
    h.sent.push(...emails);
    return { ok: true, ids: emails.map((_, i) => `id-${i}`) };
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
const post = (cookie: string, fields: Record<string, string>) =>
  new Request("http://localhost/admin/outbox", { method: "POST", headers: { Cookie: cookie }, body: new URLSearchParams(fields) });

async function status(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e: any) {
    return e?.init?.status ?? e?.status ?? -1;
  }
}

describe("/admin/outbox access", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
    h.raw.prepare("insert into leagues (city, slug, name) values ('gyor', 'gyor', 'Padelpárbaj Győr')").run();
    h.raw
      .prepare("insert into email_messages (kind, to_email, subject, text, status) values ('pair_answer', 'anna@x.hu', 's', 't', 'held')")
      .run();
  });

  it("refuses a Játékos and a Szervező with 403, page and action alike", async () => {
    for (const cookie of [await cookieFor("jatekos", "player"), await cookieFor("szervezo", "player", true)]) {
      const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
      expect(await status(R.loader(args(get(cookie))))).toBe(403);
      expect(await status(R.action(args(post(cookie, { intent: "send", kind: "pair_answer", upTo: "1" }))))).toBe(403);
      expect(await status(R.action(args(post(cookie, { intent: "discard", kind: "pair_answer", upTo: "1" }))))).toBe(403);
    }
    expect(h.raw.prepare("select status from email_messages").all()).toEqual([{ status: "held" }]);
    expect(h.sent).toEqual([]);
  });

  it("sends a logged-out visitor to the login page", async () => {
    expect(await status(R.loader({ request: get(""), params: {}, context: {} } as any))).toBe(302);
  });

  it("lets the Admin see and send held mail", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
    const page = await R.loader(args(get(cookie)));
    expect(page.held.map((x) => [x.kind, x.count])).toEqual([["pair_answer", 1]]);
    expect(await R.action(args(post(cookie, { intent: "send", kind: "pair_answer", upTo: "1" })))).toEqual({
      notice: "1 levél indult. Most 1 ment ki, a többi a napi kvóta szerint megy.",
    });
    expect(h.sent.map((m) => m.to)).toEqual(["anna@x.hu"]);
  });

  it("rejects an unknown kind", async () => {
    const cookie = await cookieFor("admin", "superadmin");
    const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
    expect(await status(R.action(args(post(cookie, { intent: "send", kind: "nope", upTo: "1" }))))).toBe(400);
  });
});

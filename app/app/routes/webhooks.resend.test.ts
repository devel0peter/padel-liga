// Resend's webhook (#193, #242) on a real SQLite (~/test/sqlite): a signed
// delivery event marks the email it names, a permanent bounce also blocks the
// address, and the Admin's player profile shows both. Nothing is sent.
import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = `whsec_${btoa("a test secret, never a real one")}`;
const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: { RESEND_WEBHOOK_SECRET: `whsec_${btoa("a test secret, never a real one")}` } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({ MAX_BATCH: 100, relayConfigured: () => false, sendEmails: async () => [] }));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const Webhook = await import("~/routes/webhooks.resend");
const Profile = await import("~/routes/admin.user");

async function signed(event: unknown): Promise<Request> {
  const body = JSON.stringify(event);
  const id = `msg_${Math.random().toString(36).slice(2)}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(SECRET.slice("whsec_".length)), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
  const signature = `v1,${btoa(String.fromCharCode(...mac))}`;
  return new Request("http://localhost/webhooks/resend", {
    method: "POST",
    headers: { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": signature },
    body,
  });
}

const post = async (event: unknown) => ((await Webhook.action({ request: await signed(event), params: {}, context: {} } as any)) as Response).status;
const one = (q: string, ...p: unknown[]) => h.raw.prepare(q).get(...p);
const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

async function admin(): Promise<string> {
  h.raw.exec("insert into users (id, email, name, sex, consent_at, platform_role) values ('adm', 'adm@x.hu', 'Admin', 'female', 1, 'superadmin')");
  return (await createSession("adm")).split(";")[0];
}
const profile = async (cookie: string, id = "a") =>
  Profile.loader({ request: new Request(`http://localhost/admin/users/${id}`, { headers: { Cookie: cookie } }), params: { id }, context: {} } as any);

beforeEach(() => {
  h.raw = migratedDatabase();
  h.raw.exec("insert into users (id, email, name, consent_at) values ('a', 'anna@x.hu', 'Kovács Anna', 1), ('b', 'bela@x.hu', 'Nagy Béla', 1)");
  const insert = h.raw.prepare(
    "insert into email_messages (id, kind, to_email, subject, status, provider_id, sent_at, created_at, last_error) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  // Anna: a group email by Resend, a pair email by the relay naming Béla's
  // address, a failed one, one waiting; Béla: his own.
  insert.run(1, "groups_published", "anna@x.hu", "Kihirdettük a csoportokat", "sent", "re_1", sec("2026-11-08T09:00:05Z"), sec("2026-11-08T09:00:00Z"), null);
  insert.run(2, "pair_created", "Anna@X.hu", "Párod: Nagy Béla (bela@x.hu)", "sent", "<m2@padelparbaj.hu>", sec("2026-11-09T10:00:05Z"), sec("2026-11-09T10:00:00Z"), null);
  insert.run(3, "match_proposal", "anna@x.hu", "Időpont", "failed", null, null, sec("2026-11-10T10:00:00Z"), "550 <anna@x.hu> mailbox unavailable");
  insert.run(4, "match_result", "anna@x.hu", "Eredmény", "pending", null, null, sec("2026-11-11T10:00:00Z"), null);
  insert.run(5, "groups_published", "bela@x.hu", "Kihirdettük a csoportokat", "sent", "re_5", sec("2026-11-08T09:00:05Z"), sec("2026-11-08T09:00:00Z"), null);
});

describe("Resend delivery events (#242)", () => {
  it("marks the email the event names as delivered, with the event's time", async () => {
    expect(await post({ type: "email.delivered", created_at: "2026-11-08T09:00:09.000Z", data: { email_id: "re_1", to: ["anna@x.hu"] } })).toBe(204);
    expect(one("select delivery, delivery_at from email_messages where id = 1")).toEqual({ delivery: "delivered", delivery_at: sec("2026-11-08T09:00:09Z") });
    expect(one("select delivery from email_messages where id = 5").delivery).toBeNull();
  });

  it("a permanent bounce marks the email and blocks the address; a later delivered event doesn't undo it", async () => {
    await post({ type: "email.bounced", created_at: "2026-11-08T09:01:00.000Z", data: { email_id: "re_5", to: ["bela@x.hu"], bounce: { type: "Permanent" } } });
    await post({ type: "email.delivered", created_at: "2026-11-08T09:02:00.000Z", data: { email_id: "re_5", to: ["bela@x.hu"] } });
    expect(one("select delivery from email_messages where id = 5").delivery).toBe("bounced");
    expect(one("select reason from email_suppressions where email = 'bela@x.hu'").reason).toBe("bounced");
  });

  it("answers 204 for an id no stored email has, and 401 without a valid signature", async () => {
    expect(await post({ type: "email.delivered", data: { email_id: "re_unknown", to: ["x@x.hu"] } })).toBe(204);
    const forged = await signed({ type: "email.delivered", data: { email_id: "re_1" } });
    const bad = new Request(forged.url, { method: "POST", headers: { ...Object.fromEntries(forged.headers), "svix-signature": "v1,AAAA" }, body: "{}" });
    expect(((await Webhook.action({ request: bad, params: {}, context: {} } as any)) as Response).status).toBe(401);
    expect(one("select delivery from email_messages where id = 1").delivery).toBeNull();
  });
});

describe("the email log on the Admin's player profile (#242)", () => {
  it("lists every email made for the address, newest first, in Hungarian, with how it went out and what became of it", async () => {
    await post({ type: "email.delivered", created_at: "2026-11-08T09:00:09.000Z", data: { email_id: "re_1", to: ["anna@x.hu"] } });
    const { mail } = await profile(await admin());
    expect(mail.total).toBe(4);
    expect(mail.rows.map((r: any) => [r.id, r.kindLabel, r.status, r.via])).toEqual([
      [4, "Eredmény megerősítése", "Sorban vár", null],
      [3, "Időpont-ajánlat", "Nem ment ki", null],
      [2, "Párba tett a szervező", "Elküldve", "relay"],
      [1, "Kihirdetett csoportok", "Kézbesítve", "resend"],
    ]);
    expect(mail.rows[2].note).toBe("A Google-relé nem jelzi vissza a kézbesítést.");
    expect(mail.rows[3].deliveryAt).toEqual(new Date("2026-11-08T09:00:09Z"));
    expect(mail.suppression).toBeNull();
  });

  it("shows no other person's address: subjects and failure reasons are hidden; no login code either", async () => {
    h.raw.exec("insert into email_messages (id, kind, to_email, subject, status, provider_id, sent_at) values (6, 'login_code', 'anna@x.hu', '216 950 a belépőkódod', 'sent', 're_6', 1)");
    const { mail } = await profile(await admin());
    expect(mail.rows.find((r: any) => r.id === 6)?.subject).toBe("••• ••• a belépőkódod");
    const text = JSON.stringify(mail);
    expect(text).not.toContain("bela@x.hu");
    expect(text).not.toContain("@");
  });

  it("says when the address is blocked, and since when", async () => {
    await post({ type: "email.complained", created_at: "2026-11-08T10:00:00.000Z", data: { email_id: "re_5", to: ["bela@x.hu"] } });
    const { mail } = await profile(await admin(), "b");
    expect(mail.suppression).toMatchObject({ reason: "complained" });
    expect(mail.rows[0].status).toBe("Spamnek jelölte");
  });

  it("is empty for an account whose stored mail was deleted with it (spec section 3)", async () => {
    h.raw.exec("delete from email_messages where lower(to_email) = 'anna@x.hu'");
    const { mail } = await profile(await admin());
    expect(mail).toEqual({ rows: [], total: 0, suppression: null });
  });

  it("is the Admin's only: a Szervező gets 403", async () => {
    h.raw.exec("insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győr')");
    h.raw.exec("insert into users (id, email, name, sex, consent_at) values ('o', 'o@x.hu', 'Org', 'male', 1)");
    h.raw.exec("insert into league_admins (league_id, user_id) values (1, 'o')");
    const cookie = (await createSession("o")).split(";")[0];
    const status = await profile(cookie).then(
      () => 200,
      (e: any) => e?.init?.status ?? e?.status,
    );
    expect(status).toBe(403);
  });
});

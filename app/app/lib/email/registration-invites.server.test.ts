// The registration invite (#20, D26) on a real SQLite (~/test/sqlite): who it
// is queued for, and that each address is claimed once. Only queued, never
// sent: Resend is stubbed and fails the test if called.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/resend.server", () => ({
  MAX_BATCH: 100,
  sendBatch: async () => {
    throw new Error("nothing may be sent");
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const O = await import("~/lib/email/outbox.server");
const S = await import("~/lib/signups-admin.server");

const queued = () =>
  h.raw.prepare("select to_email from email_messages where kind = 'registration_invite' order by to_email").all().map((r: any) => r.to_email);
const invites = () => h.raw.prepare("select email from account_invites order by email").all().map((r: any) => r.email);

function signup(v: { mode: "pair" | "solo"; name1: string; email1: string; name2?: string; email2?: string; city?: string }) {
  return h.raw
    .prepare(
      "insert into interest_signups (mode, name1, email1, name2, email2, city, level, consent_at) values (?, ?, ?, ?, ?, ?, 'kezdo', 1) returning id",
    )
    .get(v.mode, v.name1, v.email1, v.name2 ?? null, v.email2 ?? null, v.city ?? "gyor").id as number;
}

describe("queueRegistrationInvites", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  });

  it("invites both addresses of a pair signup, once each", async () => {
    signup({ mode: "pair", name1: "Anna", email1: "anna@x.hu", name2: "Béla", email2: "bela@x.hu" });
    expect(await O.queueRegistrationInvites()).toBe(2);
    expect(queued()).toEqual(["anna@x.hu", "bela@x.hu"]);
    expect(invites()).toEqual(["anna@x.hu", "bela@x.hu"]);
    expect(h.raw.prepare("select invited_at is not null as a, invited2_at is not null as b from interest_signups").get()).toEqual({
      a: 1,
      b: 1,
    });
    // A second run, or Béla's own signup naming Anna, invites nobody again.
    signup({ mode: "pair", name1: "Béla", email1: "bela@x.hu", name2: "Anna", email2: "anna@x.hu" });
    expect(await O.queueRegistrationInvites()).toBe(0);
    expect(queued()).toEqual(["anna@x.hu", "bela@x.hu"]);
  });

  it("deleting the signup removes both addresses' account invites, unless another signup names them", async () => {
    const id = signup({ mode: "pair", name1: "Anna", email1: "anna@x.hu", name2: "Béla", email2: "bela@x.hu" });
    signup({ mode: "pair", name1: "Cili", email1: "cili@x.hu", name2: "Béla", email2: "BELA@x.hu" });
    await O.queueRegistrationInvites();
    expect(invites()).toEqual(["anna@x.hu", "bela@x.hu", "cili@x.hu"]);
    await S.deleteSignup(id);
    expect(invites()).toEqual(["bela@x.hu", "cili@x.hu"]);
  });

  it("invites paired solos, and a solo still waiting with the solo text, all held (#96)", async () => {
    const c = signup({ mode: "solo", name1: "Cili", email1: "cili@x.hu" });
    const d = signup({ mode: "solo", name1: "Dani", email1: "dani@x.hu" });
    signup({ mode: "solo", name1: "Ede", email1: "ede@x.hu" });
    h.raw.prepare("update interest_signups set paired_with = ?, status = 'paired' where id = ?").run(d, c);
    h.raw.prepare("update interest_signups set paired_with = ?, status = 'paired' where id = ?").run(c, d);
    expect(await O.queueRegistrationInvites()).toBe(3);
    expect(queued()).toEqual(["cili@x.hu", "dani@x.hu", "ede@x.hu"]);
    const text = (to: string) =>
      h.raw.prepare("select text, status from email_messages where to_email = ?").get(to) as { text: string; status: string };
    expect(text("ede@x.hu").status).toBe("held");
    expect(text("ede@x.hu").text).toContain("Még keresünk neked párt, addig regisztrálj.");
    expect(text("cili@x.hu").text).not.toContain("Még keresünk neked párt");
  });

  it("asks the signer of a pair signup without the partner's email to add it (#96)", async () => {
    signup({ mode: "pair", name1: "Anna", email1: "anna@x.hu", name2: "Béla" });
    expect(await O.queueRegistrationInvites()).toBe(1);
    const row = h.raw.prepare("select to_email, text, status from email_messages").get();
    expect(row).toMatchObject({ to_email: "anna@x.hu", status: "held" });
    expect(row.text).toContain("Belépés után add meg, és ő is kap meghívót.");
  });
});

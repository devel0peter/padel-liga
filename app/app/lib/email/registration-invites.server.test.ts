// The registration invite (#20, D26) on a real SQLite (~/test/sqlite): who it
// is sent to, and that each address is claimed once. The sender is stubbed
// and records what it gets; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async (emails: any[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
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
    h.sent = [];
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  });

  it("invites both addresses of a pair signup, once each", async () => {
    signup({ mode: "pair", name1: "Anna", email1: "anna@x.hu", name2: "Béla", email2: "bela@x.hu" });
    expect(await O.queueRegistrationInvites()).toBe(2);
    expect(queued()).toEqual(["anna@x.hu", "bela@x.hu"]);
    expect(invites()).toEqual(["anna@x.hu", "bela@x.hu"]);
    // Sent right away (#112).
    expect(h.sent.map((m) => m.to).sort()).toEqual(["anna@x.hu", "bela@x.hu"]);
    expect(h.raw.prepare("select invited_at is not null as a, invited2_at is not null as b from interest_signups").get()).toEqual({
      a: 1,
      b: 1,
    });
    // A second run, or Béla's own signup naming Anna, invites nobody again.
    signup({ mode: "pair", name1: "Béla", email1: "bela@x.hu", name2: "Anna", email2: "anna@x.hu" });
    expect(await O.queueRegistrationInvites()).toBe(0);
    expect(queued()).toEqual(["anna@x.hu", "bela@x.hu"]);
    expect(h.sent).toHaveLength(2);
  });

  it("deleting the signup removes both addresses' account invites, unless another signup names them", async () => {
    const id = signup({ mode: "pair", name1: "Anna", email1: "anna@x.hu", name2: "Béla", email2: "bela@x.hu" });
    signup({ mode: "pair", name1: "Cili", email1: "cili@x.hu", name2: "Béla", email2: "BELA@x.hu" });
    await O.queueRegistrationInvites();
    expect(invites()).toEqual(["anna@x.hu", "bela@x.hu", "cili@x.hu"]);
    await S.deleteSignup(id);
    expect(invites()).toEqual(["bela@x.hu", "cili@x.hu"]);
  });

  it("invites paired solos, and a solo still waiting with the solo text, all sent (#96, #112)", async () => {
    const c = signup({ mode: "solo", name1: "Cili", email1: "cili@x.hu" });
    const d = signup({ mode: "solo", name1: "Dani", email1: "dani@x.hu" });
    signup({ mode: "solo", name1: "Ede", email1: "ede@x.hu" });
    h.raw.prepare("update interest_signups set paired_with = ?, status = 'paired' where id = ?").run(d, c);
    h.raw.prepare("update interest_signups set paired_with = ?, status = 'paired' where id = ?").run(c, d);
    expect(await O.queueRegistrationInvites()).toBe(3);
    expect(queued()).toEqual(["cili@x.hu", "dani@x.hu", "ede@x.hu"]);
    const text = (to: string) => h.sent.find((m) => m.to === to).text as string;
    expect(h.raw.prepare("select distinct status from email_messages").all()).toEqual([{ status: "sent" }]);
    expect(text("ede@x.hu")).toContain("Még keresünk neked párt, addig regisztrálj.");
    expect(text("cili@x.hu")).not.toContain("Még keresünk neked párt");
  });

  it("says when and where the league starts, from the league's season (#131)", async () => {
    const s = (iso: string) => Date.parse(iso) / 1000;
    h.raw
      .prepare(
        "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Ősz', ?, ?, '2026-11-09')",
      )
      .run(s("2026-11-01T23:00:00Z"), s("2026-11-08T22:59:00Z"));
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?), (1, 2, ?, ?)")
      .run(s("2026-11-08T23:00:00Z"), s("2026-11-29T22:59:00Z"), s("2026-11-29T23:00:00Z"), s("2026-12-20T22:59:00Z"));
    signup({ mode: "solo", name1: "Ede", email1: "ede@x.hu" });
    signup({ mode: "solo", name1: "Pál", email1: "pal@x.hu", city: "pecs" });
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('pecs', 'Pécs', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (2, 'pecs', 'pecs', 'Padelpárbaj Pécs')`);
    expect(await O.queueRegistrationInvites(new Date("2026-11-02T08:00:00Z"))).toBe(2);
    const text = (to: string) => h.sent.find((m) => m.to === to).text as string;
    expect(text("ede@x.hu")).toContain("Köszi, hogy előzetesen jelentkeztél a Padelpárbajra! A liga november 9-én indul (Győr).");
    // Pécs has a league but no season yet: no date sentence.
    expect(text("pal@x.hu")).toContain("Köszi, hogy előzetesen jelentkeztél a Padelpárbajra! Regisztrálni és nevezni itt tudsz:");
    expect(text("pal@x.hu")).not.toContain("indul");
  });

  it("asks the signer of a pair signup without the partner's email to add it (#96)", async () => {
    signup({ mode: "pair", name1: "Anna", email1: "anna@x.hu", name2: "Béla" });
    expect(await O.queueRegistrationInvites()).toBe(1);
    const row = h.raw.prepare("select to_email, status from email_messages").get();
    expect(row).toMatchObject({ to_email: "anna@x.hu", status: "sent" });
    expect(h.sent[0].text).toContain("belépéskor add meg, és ő is kap meghívót.");
  });
});

// Marking a paired solo signup withdrawn (#114) on a real SQLite
// (~/test/sqlite): the partner goes back to the waiting list, a withdrawn
// signup forms no pair and gets no invite, and undoing it re-pairs nobody.
// Mail is sent right away since #112; here the sender is stubbed as "no
// provider available now", so every email stays queued (pending) and
// nothing leaves the process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async (emails: any[]) => emails.map(() => ({ ok: false, error: "no provider now", retryLater: true })),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const S = await import("~/lib/signups-admin.server");
const O = await import("~/lib/email/outbox.server");
const SP = await import("~/lib/signup-partners.server");
const SOLO = await import("~/lib/solo-pairing.server");
const { waitingSolos, soloPairs } = await import("~/lib/solo-pairing");

const all = (q: string) => h.raw.prepare(q).all();
const activePairs = () => all("select player_a, player_b from pairs where status = 'active'");
const queued = () =>
  all("select to_email from email_messages where kind = 'registration_invite' order by to_email").map((r: any) => r.to_email);
const mail = (where = "1") =>
  all(`select kind, to_email, status from email_messages where ${where} order by kind, to_email`);
const row = (id: number) => h.raw.prepare("select status, paired_with from interest_signups where id = ?").get(id);

function solo(name: string, email: string) {
  return h.raw
    .prepare(
      "insert into interest_signups (mode, name1, email1, city, level, consent_at) values ('solo', ?, ?, 'gyor', 'kezdo', 1) returning id",
    )
    .get(name, email).id as number;
}

// What the Szervező's "Párkeresők" page shows (admin.league-solos.tsx).
async function waitingNames() {
  return waitingSolos(await S.listSignups(), "gyor").map((r) => r.name1);
}

function pairUp(a: number, b: number) {
  const set = h.raw.prepare("update interest_signups set paired_with = ?, status = 'paired' where id = ?");
  set.run(b, a);
  set.run(a, b);
}

describe("withdrawing a paired solo signup (#114)", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  afterEach(() => {
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
    h.raw = migratedDatabase();
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  });

  it("frees the partner: they wait for a partner again, and the pair is gone", async () => {
    const c = solo("Cili", "c@x.hu");
    const d = solo("Dani", "d@x.hu");
    const e = solo("Ede", "e@x.hu");
    pairUp(c, d);
    expect(await waitingNames()).toEqual(["Ede"]);

    await S.updateSignup(c, { status: "withdrawn" });

    expect(await waitingNames()).toEqual(["Dani", "Ede"]);
    expect(soloPairs(await S.listSignups(), "gyor")).toEqual([]);
    expect(row(c)).toEqual({ status: "withdrawn", paired_with: null });
    expect(row(d)).toEqual({ status: "new", paired_with: null });
    expect(row(e)).toEqual({ status: "new", paired_with: null });
  });

  it("works from either side", async () => {
    const c = solo("Cili", "c@x.hu");
    const d = solo("Dani", "d@x.hu");
    pairUp(c, d);
    await S.updateSignup(d, { status: "withdrawn" });
    expect(row(c)).toEqual({ status: "new", paired_with: null });
    expect(await waitingNames()).toEqual(["Cili"]);
  });

  it("a note or another status on a paired solo keeps the pair", async () => {
    const c = solo("Cili", "c@x.hu");
    const d = solo("Dani", "d@x.hu");
    pairUp(c, d);
    await S.updateSignup(c, { adminNote: "hívjuk fel" });
    await S.updateSignup(c, { status: "contacted" });
    expect(row(c)).toEqual({ status: "contacted", paired_with: d });
    expect(row(d)).toEqual({ status: "paired", paired_with: c });
  });

  it("a partner who is withdrawn too stays withdrawn", async () => {
    const c = solo("Cili", "c@x.hu");
    const d = solo("Dani", "d@x.hu");
    pairUp(c, d);
    h.raw.prepare("update interest_signups set status = 'withdrawn' where id = ?").run(d);
    await S.updateSignup(c, { status: "withdrawn" });
    expect(row(c)).toEqual({ status: "withdrawn", paired_with: null });
    expect(row(d)).toEqual({ status: "withdrawn", paired_with: null });
    expect(await waitingNames()).toEqual([]);
  });

  it("the withdrawn player registering forms no pair, even once the partner registers too", async () => {
    const c = solo("Cili", "c@x.hu");
    const d = solo("Dani", "d@x.hu");
    pairUp(c, d);
    await S.updateSignup(c, { status: "withdrawn" });
    for (const [id, name] of [["c", "Cili"], ["d", "Dani"]] as const) {
      h.raw.prepare("insert into users (id, email, name, consent_at) values (?, ?, ?, 1)").run(id, `${id}@x.hu`, name);
      await SP.formSignupPairs(id);
    }
    expect(activePairs()).toEqual([]);
  });

  it("queues no new invite to the withdrawn signup, but still invites the partner", async () => {
    const c = solo("Cili", "c@x.hu");
    const d = solo("Dani", "d@x.hu");
    pairUp(c, d);
    await S.updateSignup(c, { status: "withdrawn" });
    expect(await O.queueRegistrationInvites()).toBe(1);
    expect(queued()).toEqual(["d@x.hu"]);
    expect(mail("to_email = 'c@x.hu'")).toEqual([]);
  });

  // The Szervező paired them and queued the invites, then Cili pulls out
  // before anything is sent.
  async function pairedAndInvited() {
    const c = solo("Cili", "c@x.hu");
    const d = solo("Dani", "d@x.hu");
    expect(await SOLO.pairSolos(c, d, "gyor", "Győr")).toBeNull();
    expect(await O.queueRegistrationInvites()).toBe(2);
    expect(mail().map((m: any) => `${m.kind} ${m.to_email}`)).toEqual([
      "pair_intro c@x.hu",
      "pair_intro d@x.hu",
      "registration_invite c@x.hu",
      "registration_invite d@x.hu",
    ]);
    return { c, d };
  }

  it("deletes the unsent invite and pair intros: nothing goes to her, nothing about her to the partner", async () => {
    const { c } = await pairedAndInvited();
    await S.updateSignup(c, { status: "withdrawn" });
    expect(mail()).toEqual([{ kind: "registration_invite", to_email: "d@x.hu", status: "pending" }]);
  });

  it("leaves mail being sent right now alone", async () => {
    const { c } = await pairedAndInvited();
    h.raw.exec("update email_messages set status = 'sending'");
    await S.updateSignup(c, { status: "withdrawn" });
    expect(mail()).toHaveLength(4);
  });

  it("keeps mail already sent", async () => {
    const { c } = await pairedAndInvited();
    h.raw.exec("update email_messages set status = 'sent'");
    await S.updateSignup(c, { status: "withdrawn" });
    expect(mail()).toHaveLength(4);
  });

  it("clears the invited mark with the invite, so undoing the withdrawal offers her the invite again", async () => {
    const { c } = await pairedAndInvited();
    await S.updateSignup(c, { status: "withdrawn" });
    expect(h.raw.prepare("select invited_at from interest_signups where id = ?").get(c)).toEqual({ invited_at: null });
    await S.updateSignup(c, { status: "new" });
    expect(await O.queueRegistrationInvites()).toBe(1);
    expect(mail("to_email = 'c@x.hu'")).toEqual([{ kind: "registration_invite", to_email: "c@x.hu", status: "pending" }]);
    expect(row(c)).toEqual({ status: "new", paired_with: null });
  });

  it("matches whole addresses: withdrawing anna@ leaves the intros of hanna@ and her partner alone", async () => {
    const a = solo("Anna", "anna@x.hu");
    const b = solo("Bea", "bea@x.hu");
    const h2 = solo("Hanna", "hanna@x.hu");
    const z = solo("Zoli", "zoli@x.hu");
    await SOLO.pairSolos(a, b, "gyor", "Győr");
    await SOLO.pairSolos(h2, z, "gyor", "Győr");
    await O.queueRegistrationInvites();
    await S.updateSignup(a, { status: "withdrawn" });
    expect(mail("kind = 'pair_intro'").map((m: any) => m.to_email)).toEqual(["hanna@x.hu", "zoli@x.hu"]);
    expect(mail("kind = 'registration_invite'").map((m: any) => m.to_email)).toEqual([
      "bea@x.hu",
      "hanna@x.hu",
      "zoli@x.hu",
    ]);
  });

  it("leaves mail to other people alone", async () => {
    const { c } = await pairedAndInvited();
    const e = solo("Ede", "e@x.hu");
    const f = solo("Fanni", "f@x.hu");
    await SOLO.pairSolos(e, f, "gyor", "Győr");
    await S.updateSignup(c, { status: "withdrawn" });
    expect(mail("kind = 'pair_intro'").map((m: any) => m.to_email)).toEqual(["e@x.hu", "f@x.hu"]);
  });

  it("setting the status back re-pairs nobody", async () => {
    const c = solo("Cili", "c@x.hu");
    const d = solo("Dani", "d@x.hu");
    pairUp(c, d);
    await S.updateSignup(c, { status: "withdrawn" });
    await S.updateSignup(c, { status: "new" });
    expect(row(c)).toEqual({ status: "new", paired_with: null });
    expect(row(d)).toEqual({ status: "new", paired_with: null });
    expect(await waitingNames()).toEqual(["Cili", "Dani"]);
  });
});

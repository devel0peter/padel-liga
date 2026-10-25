// "Partner has no email" (#96, D35) on a real SQLite (~/test/sqlite): the
// box, saving the address, the one held invite, and the pair forming once the
// partner registers. Resend is stubbed and fails the test if called: nothing
// is sent, the invite waits on Kimenő levelek.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({
  listedCities: async () => [{ slug: "gyor" }],
  listCities: async () => [{ slug: "gyor", name: "Győr" }],
}));
vi.mock("~/lib/email/resend.server", () => ({
  MAX_BATCH: 100,
  sendBatch: async () => {
    throw new Error("nothing may be sent");
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const SP = await import("~/lib/signup-partners.server");
const { PARTNER_EMAIL_REFUSALS } = await import("~/lib/signup-partners");

const all = (q: string, ...p: any[]) => h.raw.prepare(q).all(...p);
const invites = () => all("select to_email, status, text from email_messages where kind = 'registration_invite' order by id");
const activePairs = () => all("select player_a, player_b from pairs where status = 'active' order by id");

function signup(v: { mode?: "pair" | "solo"; name1: string; email1: string; name2?: string; email2?: string }) {
  return h.raw
    .prepare("insert into interest_signups (mode, name1, email1, name2, email2, city, level, consent_at) values (?, ?, ?, ?, ?, 'gyor', 'kezdo', 1) returning id")
    .get(v.mode ?? "pair", v.name1, v.email1, v.name2 ?? null, v.email2 ?? null).id as number;
}
function register(id: string, name: string, email = `${id}@x.hu`, done = true) {
  h.raw.prepare("insert into users (id, email, name, consent_at) values (?, ?, ?, ?)").run(id, email, name, done ? 1 : null);
}
const user = (id: string) => ({ id, email: `${id}@x.hu`, name: id.toUpperCase() }) as any;

describe("partner without an email (#96)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  });

  it("shows the box only to the signer of a pair signup without the partner's email, with the name and no address", async () => {
    const id = signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla" });
    signup({ name1: "Cili", email1: "c@x.hu", name2: "Dani", email2: "d@x.hu" });
    signup({ mode: "solo", name1: "Ede", email1: "e@x.hu" });
    for (const [u, n] of [["a", "Anna"], ["c", "Cili"], ["e", "Ede"], ["x", "Xavér"]]) register(u, n);
    expect(await SP.missingPartnerEmails(user("a"))).toEqual([{ signupId: id, leagueId: 1, name: "Béla" }]);
    expect(JSON.stringify(await SP.missingPartnerEmails(user("a")))).not.toContain("@");
    for (const u of ["c", "e", "x"]) expect(await SP.missingPartnerEmails(user(u))).toEqual([]);
    // Already in a pair in the league (a Szervező paired her): no box.
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'a', 'x')`);
    expect(await SP.missingPartnerEmails(user("a"))).toEqual([]);
  });

  it("saving fills email2 and queues one held invite to it; saving twice queues no second one", async () => {
    const id = signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla" });
    register("a", "Anna");
    expect(await SP.savePartnerEmail(user("a"), id, " Bela@X.hu ")).toEqual({ ok: true });
    expect(all("select email2 from interest_signups")).toEqual([{ email2: "bela@x.hu" }]);
    expect(invites()).toHaveLength(1);
    expect(invites()[0]).toMatchObject({ to_email: "bela@x.hu", status: "held" });
    expect(all("select email from account_invites")).toEqual([{ email: "bela@x.hu" }]);
    // The box is gone; a second submit (another tab) changes nothing.
    expect(await SP.missingPartnerEmails(user("a"))).toEqual([]);
    expect(await SP.savePartnerEmail(user("a"), id, "bela@x.hu")).toEqual({ ok: true });
    expect(await SP.savePartnerEmail(user("a"), id, "mas@x.hu")).toMatchObject({ ok: false });
    expect(all("select email2 from interest_signups")).toEqual([{ email2: "bela@x.hu" }]);
    expect(invites()).toHaveLength(1);
  });

  it("the partner registers: the pair forms as for any signup pair (#89)", async () => {
    const id = signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla" });
    register("a", "Anna");
    await SP.savePartnerEmail(user("a"), id, "b@x.hu");
    expect(activePairs()).toEqual([]);
    register("b", "Béla");
    await SP.formSignupPairs("b");
    expect(activePairs()).toEqual([{ player_a: "a", player_b: "b" }]);
    // Her first-login page names Anna.
    expect(await SP.signupPartnerNames("b@x.hu")).toEqual(["Anna"]);
  });

  it("a partner who already registered is paired at once and gets no invite", async () => {
    const id = signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla" });
    register("a", "Anna");
    register("b", "Béla");
    expect(await SP.savePartnerEmail(user("a"), id, "b@x.hu")).toEqual({ ok: true });
    expect(invites()).toEqual([]);
    expect(activePairs()).toEqual([{ player_a: "b", player_b: "a" }]);
  });

  it("the partner's own signup still wins (#89): no pair with someone who named another partner", async () => {
    const id = signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla" });
    signup({ name1: "Béla", email1: "b@x.hu", name2: "Cili", email2: "c@x.hu" });
    register("a", "Anna");
    register("b", "Béla");
    expect(await SP.savePartnerEmail(user("a"), id, "b@x.hu")).toEqual({ ok: true });
    await SP.formSignupPairs("b");
    expect(activePairs()).toEqual([]);
  });

  it("refuses your own address, an invalid one, or one already paired in the league, in Hungarian", async () => {
    const id = signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla" });
    register("a", "Anna");
    register("c", "Cili");
    register("d", "Dani");
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'c', 'd')`);
    expect(await SP.savePartnerEmail(user("a"), id, "A@x.hu")).toEqual({ ok: false, error: PARTNER_EMAIL_REFUSALS.self });
    expect(await SP.savePartnerEmail(user("a"), id, "nem-cim")).toEqual({ ok: false, error: PARTNER_EMAIL_REFUSALS.email });
    expect(await SP.savePartnerEmail(user("a"), id, "D@x.hu")).toEqual({ ok: false, error: PARTNER_EMAIL_REFUSALS.paired });
    expect(all("select email2 from interest_signups")).toEqual([{ email2: null }]);
    expect(invites()).toEqual([]);
  });

  it("refuses someone else's signup", async () => {
    const id = signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla" });
    register("x", "Xavér");
    expect(await SP.savePartnerEmail(user("x"), id, "b@x.hu")).toMatchObject({ ok: false });
    expect(all("select email2 from interest_signups")).toEqual([{ email2: null }]);
  });
});

// The pair from the interest signup (#89, D27) on a real SQLite with every
// migration applied (~/test/sqlite). Email is stubbed; nothing leaves the
// process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async () => {},
  queueGroupsPublished: async () => {},
}));

const { migratedDatabase } = await import("~/test/sqlite");
const SP = await import("~/lib/signup-partners.server");
const P = await import("~/lib/pairs.server");
const I = await import("~/lib/interest.server");

const all = (q: string) => h.raw.prepare(q).all();
const activePairs = () => all("select league_id, player_a, player_b from pairs where status = 'active' order by id");
const league = { id: 1, name: "Padelpárbaj Győr" };

function signup(v: { mode?: "pair" | "solo"; name1: string; email1: string; name2?: string; email2?: string; city?: string; level?: string }) {
  return h.raw
    .prepare(
      "insert into interest_signups (mode, name1, email1, name2, email2, city, level, consent_at) values (?, ?, ?, ?, ?, ?, ?, 1) returning id",
    )
    .get(v.mode ?? "pair", v.name1, v.email1, v.name2 ?? null, v.email2 ?? null, v.city ?? "gyor", v.level ?? "kezdo").id as number;
}

// An account; `done` once the first-login page is finished (consent given).
function register(id: string, name: string, done = true) {
  h.raw.prepare("insert into users (id, email, name, consent_at) values (?, ?, ?, ?)").run(id, `${id}@x.hu`, name, done ? 1 : null);
}
const finishWelcome = (id: string) => h.raw.prepare("update users set consent_at = 1 where id = ?").run(id);
const user = (id: string) => ({ id, email: `${id}@x.hu`, name: id.toUpperCase() }) as any;

describe("signup pairs on real SQLite", () => {
  // formSignupPairs never throws: it logs. A logged error fails the test, so
  // "nothing formed" can't pass because of a crash.
  let errors: ReturnType<typeof vi.spyOn>;
  afterEach(() => {
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
    h.raw = migratedDatabase();
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('pecs', 'Pécs', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  });

  it("A registers, then B: no pair after A alone, one active pair after B's first login", async () => {
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu" });
    register("a", "Anna");
    await SP.formSignupPairs("a");
    expect(activePairs()).toEqual([]);
    // B logs in for the first time: no consent yet, so nothing either.
    register("b", "Béla", false);
    await SP.formSignupPairs("b");
    expect(activePairs()).toEqual([]);
    // B finishes the first-login page.
    finishWelcome("b");
    await SP.formSignupPairs("b");
    expect(activePairs()).toEqual([{ league_id: 1, player_a: "a", player_b: "b" }]);
    // Logging in again, from either side, changes nothing.
    await SP.formSignupPairs("a");
    await SP.formSignupPairs("b");
    expect(activePairs()).toHaveLength(1);
    // Both see it as their active pair on /pair.
    const [oa] = await P.pairOverview(user("a"), [league]);
    const [ob] = await P.pairOverview(user("b"), [league]);
    expect(oa.pair).toMatchObject({ partnerName: "Béla" });
    expect(ob.pair).toMatchObject({ partnerName: "Anna" });
  });

  it("works from the partner's side and for solos a Szervező paired", async () => {
    signup({ name1: "Anna", email1: "A@x.hu", name2: "Béla", email2: "B@x.hu" });
    const c = signup({ mode: "solo", name1: "Cili", email1: "c@x.hu" });
    const d = signup({ mode: "solo", name1: "Dani", email1: "d@x.hu" });
    h.raw.prepare("update interest_signups set paired_with = ? where id = ?").run(d, c);
    h.raw.prepare("update interest_signups set paired_with = ? where id = ?").run(c, d);
    register("b", "Béla");
    register("a", "Anna");
    await SP.formSignupPairs("a");
    register("c", "Cili");
    register("d", "Dani");
    await SP.formSignupPairs("d");
    expect(activePairs()).toEqual([
      { league_id: 1, player_a: "b", player_b: "a" },
      { league_id: 1, player_a: "c", player_b: "d" },
    ]);
  });

  it("forms nothing, without an error, if either is already in an active pair in the league", async () => {
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu" });
    register("a", "Anna");
    register("b", "Béla");
    register("c", "Cecil");
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'c', 'a')`);
    await expect(SP.formSignupPairs("b")).resolves.toBeUndefined();
    expect(activePairs()).toEqual([{ league_id: 1, player_a: "c", player_b: "a" }]);
    // The same with the one arriving second already paired.
    h.raw.exec(`update pairs set status = 'dissolved'`);
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'b', 'c')`);
    await SP.formSignupPairs("a");
    expect(activePairs()).toEqual([{ league_id: 1, player_a: "b", player_b: "c" }]);
  });

  it("doesn't pair with a partner who has an account but hasn't finished the first-login page", async () => {
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu" });
    register("b", "Béla", false);
    register("a", "Anna");
    await SP.formSignupPairs("a");
    expect(activePairs()).toEqual([]);
  });

  it("forms it only once: after a dissolve, logging in again doesn't bring it back", async () => {
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu" });
    register("a", "Anna");
    register("b", "Béla");
    register("c", "Cecil");
    await SP.formSignupPairs("b");
    const [pair] = all("select id from pairs");
    // A Szervező dissolves it on the Párok page (#97).
    expect(await P.dissolvePair("c", 1, pair.id)).toEqual({ ok: true });
    await SP.formSignupPairs("a");
    await SP.formSignupPairs("b");
    expect(activePairs()).toEqual([]);
  });

  it("needs both sides: someone else's signup alone puts nobody in a pair", async () => {
    // Béla signed up himself with Cili; Xavér later entered Béla as his partner.
    signup({ name1: "Béla", email1: "b@x.hu", name2: "Cili", email2: "c@x.hu" });
    signup({ name1: "Xavér", email1: "x@x.hu", name2: "Béla", email2: "b@x.hu" });
    register("b", "Béla");
    register("x", "Xavér");
    await SP.formSignupPairs("x");
    expect(activePairs()).toEqual([]);
    expect([...(await SP.waitingPartners("x@x.hu"))]).toEqual([]);
    // Béla's own newer solo signup says "nobody" for Anna's old pair signup too.
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Dani", email2: "d@x.hu" });
    signup({ mode: "solo", name1: "Dani", email1: "d@x.hu" });
    register("a", "Anna");
    register("d", "Dani");
    await SP.formSignupPairs("a");
    await SP.formSignupPairs("d");
    expect(activePairs()).toEqual([]);
  });

  it("forms nothing in a city that isn't listed yet", async () => {
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('deb', 'Debrecen', 0)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (2, 'deb', 'deb', 'Padelpárbaj Debrecen')`);
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu", city: "deb" });
    register("a", "Anna");
    register("b", "Béla");
    await SP.formSignupPairs("b");
    expect(activePairs()).toEqual([]);
  });

  it("forms nothing in a city without a league, or from a withdrawn signup", async () => {
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu", city: "pecs" });
    const id = signup({ name1: "Cili", email1: "c@x.hu", name2: "Dani", email2: "d@x.hu" });
    h.raw.prepare("update interest_signups set status = 'withdrawn' where id = ?").run(id);
    for (const [u, n] of [["a", "Anna"], ["b", "Béla"], ["c", "Cili"], ["d", "Dani"]]) register(u, n);
    for (const u of ["a", "b", "c", "d"]) await SP.formSignupPairs(u);
    expect(activePairs()).toEqual([]);
  });

  it("names the partner who hasn't registered yet for /pair, never the email", async () => {
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu" });
    register("a", "Anna");
    expect([...(await SP.waitingPartners("a@x.hu"))]).toEqual([[1, "Béla"]]);
    // Logged in but the first-login page not done yet: still not registered.
    register("b", "Béla", false);
    expect([...(await SP.waitingPartners("a@x.hu"))]).toEqual([[1, "Béla"]]);
    finishWelcome("b");
    expect([...(await SP.waitingPartners("a@x.hu"))]).toEqual([]);
    // Someone the signups don't name waits for nobody.
    expect([...(await SP.waitingPartners("x@x.hu"))]).toEqual([]);
  });

  it("prefills the signup's name and level for the partner too (#130)", async () => {
    signup({ name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu", level: "halado" });
    signup({ mode: "solo", name1: "Cili", email1: "c@x.hu", level: "versenyzo" });
    expect(await I.interestProfileFor("a@x.hu")).toEqual({ name: "Anna", level: "halado" });
    expect(await I.interestProfileFor("b@x.hu")).toEqual({ name: "Béla", level: "halado" });
    expect(await I.interestProfileFor("c@x.hu")).toEqual({ name: "Cili", level: "versenyzo" });
    expect(await I.interestProfileFor("x@x.hu")).toBeNull();
    // A withdrawn signup doesn't prefill the partner.
    const id = signup({ name1: "Ede", email1: "e@x.hu", name2: "Feri", email2: "f@x.hu", level: "halado" });
    h.raw.prepare("update interest_signups set status = 'withdrawn' where id = ?").run(id);
    expect(await I.interestProfileFor("f@x.hu")).toBeNull();
  });
});

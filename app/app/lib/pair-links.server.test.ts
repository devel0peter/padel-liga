// pair-links.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the player's own pair link (2026-10-31), one per league,
// and accepting it, with the one-pair-per-league rule checked in the SQL.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
// Imported through pairs.server; a pair link sends no email.
vi.mock("~/lib/email/outbox.server", () => ({}));

const { migratedDatabase } = await import("~/test/sqlite");
const L = await import("~/lib/pair-links.server");
const { PAIR_LINK_REFUSALS } = await import("~/lib/pairs");

const one = (q: string) => h.raw.prepare(q).get();
const all = (q: string) => h.raw.prepare(q).all();
const user = (id: string, consentAt: Date | null = new Date()) => ({ id, consentAt });

function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('deb', 'Debrecen', 0)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'deb', 'deb', 'Padelpárbaj Debrecen')`);
  for (const [id, name] of [
    ["a", "Anna"],
    ["b", "Béla"],
    ["c", "Cecil"],
  ])
    h.raw.prepare("insert into users (id, email, name, consent_at) values (?, ?, ?, 1)").run(id, `${id}@x.hu`, name);
  // Has an account but hasn't finished the first-login page.
  h.raw.exec(`insert into users (id, email, name) values ('n', 'n@x.hu', 'Nándor')`);
  // Anna joined both leagues (D127); Béla and Cecil none yet.
  h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'a', 'chosen'), (2, 'a', 'chosen')`);
}

describe("pair links on real SQLite (2026-10-31)", () => {
  beforeEach(freshDb);

  it("gives a player one stable link per league, only in listed cities", async () => {
    const [box] = await L.pairLinkBoxes(user("a"));
    expect(box.league).toMatchObject({ id: 1, name: "Padelpárbaj Győr" });
    expect(box.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(await L.pairLinkBoxes(user("a"))).toEqual([box]);
    expect(all("select league_id, owner_id from pair_links")).toEqual([{ league_id: 1, owner_id: "a" }]);
    // Only in the player's own leagues: Béla has joined none.
    expect(await L.pairLinkBoxes(user("b"))).toEqual([]);
    expect((await L.pairLinkBoxes(user("b"), [{ id: 1, name: "Padelpárbaj Győr" }]))[0].token).not.toBe(box.token);
  });

  it("shows no link in a league where the player has a pair", async () => {
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'a', 'b')`);
    expect(await L.pairLinkBoxes(user("a"))).toEqual([]);
  });

  it("shows the owner's name and the league, with no check before login", async () => {
    const token = await L.pairLinkFor("a", 1);
    expect(await L.pairLinkView(token, null)).toEqual({ league: "Padelpárbaj Győr", ownerName: "Anna", refusal: null });
    expect(await L.pairLinkView(token, user("b"))).toEqual({ league: "Padelpárbaj Győr", ownerName: "Anna", refusal: null });
    expect(await L.pairLinkView(token, user("a"))).toMatchObject({ refusal: PAIR_LINK_REFUSALS.own });
  });

  it("knows no unknown token and no link in an unlisted city", async () => {
    expect(await L.pairLinkView("nincs-ilyen", null)).toBeUndefined();
    expect(await L.pairLinkView("", null)).toBeUndefined();
    const hidden = await L.pairLinkFor("a", 2);
    expect(await L.pairLinkView(hidden, null)).toBeUndefined();
    expect(await L.acceptPairLink(user("b"), hidden)).toEqual({ ok: false, error: "Ez a link nem él." });
  });

  it("makes the pair on accept, audited, and the link box goes", async () => {
    const token = await L.pairLinkFor("a", 1);
    expect(await L.acceptPairLink(user("b"), token)).toEqual({ ok: true });
    expect(one("select league_id, player_a, player_b, source, status from pairs")).toEqual({
      league_id: 1,
      player_a: "a",
      player_b: "b",
      source: "link",
      status: "active",
    });
    expect(all("select actor_id, action from audit_log")).toEqual([{ actor_id: "b", action: "pair.link" }]);
    // Accepting joins the link's league (D127, #331).
    expect(all("select league_id, user_id, source from league_members order by league_id, user_id")).toEqual([
      { league_id: 1, user_id: "a", source: "chosen" },
      { league_id: 1, user_id: "b", source: "link" },
      { league_id: 2, user_id: "a", source: "chosen" },
    ]);
    expect(await L.pairLinkBoxes(user("a"))).toEqual([]);
    expect(await L.pairLinkBoxes(user("b"))).toEqual([]);
  });

  it("refuses the owner, a player with a pair, an owner with a pair, and an unfinished account", async () => {
    const token = await L.pairLinkFor("a", 1);
    expect(await L.acceptPairLink(user("a"), token)).toEqual({ ok: false, error: PAIR_LINK_REFUSALS.own });
    expect(await L.acceptPairLink(user("n", null), token)).toEqual({ ok: false, error: "Előbb fejezd be a regisztrációt." });
    h.raw.exec(`insert into pairs (league_id, player_a, player_b) values (1, 'b', 'c')`);
    expect(await L.acceptPairLink(user("b"), token)).toEqual({ ok: false, error: PAIR_LINK_REFUSALS.you_paired });
    const cecil = await L.pairLinkFor("c", 1);
    expect(await L.acceptPairLink(user("a"), cecil)).toEqual({ ok: false, error: PAIR_LINK_REFUSALS.owner_paired });
    expect(one("select count(*) as n from pairs")).toEqual({ n: 1 });
  });

  it("a second accept of the same link makes no second pair", async () => {
    const token = await L.pairLinkFor("a", 1);
    expect(await L.acceptPairLink(user("b"), token)).toEqual({ ok: true });
    expect(await L.acceptPairLink(user("c"), token)).toEqual({ ok: false, error: PAIR_LINK_REFUSALS.owner_paired });
    expect(one("select count(*) as n from pairs")).toEqual({ n: 1 });
  });

  it("works again after the pair is dissolved", async () => {
    const token = await L.pairLinkFor("a", 1);
    await L.acceptPairLink(user("b"), token);
    h.raw.exec(`update pairs set status = 'dissolved'`);
    expect((await L.pairLinkBoxes(user("a")))[0].token).toBe(token);
    expect(await L.acceptPairLink(user("c"), token)).toEqual({ ok: true });
  });

  it("goes with the owner's account", async () => {
    await L.pairLinkFor("a", 1);
    h.raw.exec(`delete from users where id = 'a'`);
    expect(one("select count(*) as n from pair_links")).toEqual({ n: 0 });
  });
});

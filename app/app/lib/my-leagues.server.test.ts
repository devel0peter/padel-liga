// Ligáim (#394) on a real SQLite with every migration applied (~/test/sqlite):
// one card per league of the player, its numbers equal to the Tabella's
// (ladderPage), the partner by name only, and only the player's own leagues.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueSeasonEntered: async (to: string, input: any) => h.mails.push({ kind: "entered", toEmail: to, ...input }),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { myLeagueCard, myLeagueCards, myLeaguesAction, withOrigin } = await import("~/lib/my-leagues.server");
const { ladderPage, pairIdsOf } = await import("~/lib/ladder.server");
const { leagueSummary, ownPlace } = await import("~/lib/my-leagues");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (iso: string) => new Date(iso);

// Phases from Monday 9 Nov 2026 (Budapest, UTC+1), 21 days each; sets to 6 (D173).
const STARTS = ["2026-11-08T23:00:00Z", "2026-12-06T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const IN_ROUND_1 = at("2026-11-24T12:00:00Z");

function freshDb() {
  h.raw = migratedDatabase();
  h.mails = [];
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('deb', 'Debrecen', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'deb', 'deb', 'Padelpárbaj Debrecen')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-12-31T22:59:00Z"));
  STARTS.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)")
      .run(i + 1, sec(start), sec(start) + 28 * 86400 - 60),
  );
  publish(2);
}

/** `count` published groups of 3 pairs for phase 1, with every pair entered. */
function publish(count: number) {
  for (let g = 1; g <= count; g++) {
    h.raw.prepare("insert into groups (season_id, phase, number, published_at) values (1, 1, ?, ?)").run(g, sec("2026-11-06T10:00:00Z"));
    const groupId = h.raw.prepare("select id from groups where season_id = 1 and phase = 1 and number = ?").get(g).id;
    for (let s = 1; s <= 3; s++) {
      const n = 1000 + g * 10 + s;
      for (const side of ["a", "b"])
        h.raw
          .prepare("insert into users (id, email, name, phone, level, consent_at) values (?, ?, ?, '+36301234567', 'halado', 1)")
          .run(`u${n}${side}`, `u${n}${side}@titkos.example`, `Játékos ${n}${side.toUpperCase()}`);
      h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(n, `u${n}a`, `u${n}b`);
      h.raw.prepare("insert into group_pairs (group_id, pair_id, seed) values (?, ?, ?)").run(groupId, n, s);
      h.raw.prepare("insert into season_entries (season_id, pair_id, status, joins_phase) values (1, ?, 'approved', 1)").run(n);
    }
    const base = 1000 + g * 10;
    [
      [1, base + 1, base + 2],
      [2, base + 1, base + 3],
      [3, base + 2, base + 3],
    ].forEach(([week, a, b]) =>
      h.raw
        .prepare("insert into matches (group_id, pair_a, pair_b, week, deadline) values (?, ?, ?, ?, ?)")
        .run(groupId, a, b, week, sec(STARTS[0]!) + 28 * 86400 - 60),
    );
  }
}

const played = (a: number, b: number, sets: [number, number][], status = "final") =>
  h.raw
    .prepare("update matches set status = ?, outcome = ? where pair_a = ? and pair_b = ?")
    .run(status, JSON.stringify({ kind: "played", score: { sets, superTieBreak: null } }), a, b);

/** A user with a level and phone, a member of league 1 by choice. */
function member(id: string, level: string | null = "halado") {
  h.raw
    .prepare("insert into users (id, email, name, phone, level, consent_at) values (?, ?, ?, '+36309998877', ?, 1)")
    .run(id, `${id}@titkos.example`, `Tag ${id}`, level);
  h.raw.prepare("insert into league_members (league_id, user_id, source) values (1, ?, 'chosen')").run(id);
}

const user = (id: string) => h.raw.prepare("select * from users where id = ?").get(id) as any;
const asUser = (id: string) => {
  const u = user(id);
  return { ...u, consentAt: new Date(u.consent_at * 1000), elo: u.elo, level: u.level } as any;
};

beforeEach(freshDb);

describe("myLeagueCards", () => {
  it("a player in a running round: round and deadline, partner, group and place, summary, own season", async () => {
    // Group 1: 1011 beat 1012, 1013 beat 1011; group 2: one result waiting for the other pair.
    played(1011, 1012, [
      [6, 1],
      [6, 2],
    ]);
    played(1011, 1013, [
      [1, 6],
      [2, 6],
    ]);
    played(1021, 1022, [
      [6, 0],
      [6, 0],
    ], "result_pending");
    const [card, ...rest] = await myLeagueCards(asUser("u1011a"), IN_ROUND_1);
    expect(rest).toEqual([]);
    expect(card).toMatchObject({
      league: { name: "Padelpárbaj Győr", slug: "gyor", city: "Győr" },
      season: { id: 1, name: "2026/27 tél" },
      round: { kind: "running", round: 1, from: "nov. 9.", to: "dec. 6.", deadline: "dec. 6., vasárnap 23:59" },
      pair: { partner: "Játékos 1011B" },
      // 1011: a win and a played loss, 4 points; 1013 one win, 3 (spec 9).
      place: { round: 1, group: 1, rank: 1 },
      joins: null,
      summary: { round: 1, pairs: 6, groups: 2, played: 2, total: 6 },
      own: { matches: 2, wins: 1, elo: expect.any(Number) },
    });
  });

  it("the summary and the place equal the Tabella's for the same round", async () => {
    played(1021, 1023, [
      [6, 2],
      [6, 2],
    ]);
    h.raw.exec("update group_pairs set withdrawn_at = 1 where pair_id = 1012");
    const [card] = await myLeagueCards(asUser("u1022b"), IN_ROUND_1);
    const page = await ladderPage("gyor", IN_ROUND_1, await pairIdsOf("u1022b"));
    if (page?.kind !== "ladder") throw new Error("no ladder");
    expect(card!.summary).toEqual(leagueSummary(page.phase, page.bands));
    expect(card!.place).toEqual(ownPlace(page.phase, page.bands));
    // A pair withdrawn mid-round is out, as in the Tabella's tables (#34).
    expect(card!.summary).toMatchObject({ pairs: 5, groups: 2, played: 1 });
    expect(card!.place).toEqual({ round: 1, group: 2, rank: 3 });
  });

  it("before any final result in the group: the group without a place (D85)", async () => {
    const [card] = await myLeagueCards(asUser("u1011a"), IN_ROUND_1);
    expect(card!.place).toEqual({ round: 1, group: 1, rank: null });
    expect(card!.own).toMatchObject({ matches: 0, wins: 0 });
  });

  it("a player without a pair: no partner, not entered, no own matches", async () => {
    member("solo");
    const [card] = await myLeagueCards(asUser("solo"), IN_ROUND_1);
    expect(card).toMatchObject({ pair: null, place: null, joins: null, own: { matches: 0, wins: 0, elo: expect.any(Number) } });
    // The entry view says why not: no pair (#23).
    expect(card!.entry).toMatchObject({ kind: "blocked", reason: "no_pair" });
  });

  it("a pair that hasn't entered gets the existing Nevezünk button; once entered mid-round, it starts in round 2", async () => {
    member("x");
    member("y");
    h.raw.exec("insert into pairs (id, league_id, player_a, player_b) values (9001, 1, 'x', 'y')");
    let [card] = await myLeagueCards(asUser("x"), IN_ROUND_1);
    expect(card).toMatchObject({ pair: { partner: "Tag y" }, place: null, joins: null, entry: { kind: "apply", late: true } });
    // "Nevezünk" on the card: the same action as on Kezdőlap.
    const answer = await myLeaguesAction(asUser("x"), formOf({ intent: "enter", season: "1" }));
    expect(answer).toMatchObject({ season: 1, notice: expect.stringContaining("a 2. körtől") });
    [card] = await myLeagueCards(asUser("x"), IN_ROUND_1);
    expect(card).toMatchObject({ place: null, joins: { round: 2, startsAt: at(STARTS[1]!) } });
  });

  it("an entry whose round has started but no group holds the pair: the entry's status, no start line", async () => {
    member("x");
    member("y");
    h.raw.exec("insert into pairs (id, league_id, player_a, player_b) values (9001, 1, 'x', 'y')");
    h.raw.exec("insert into season_entries (season_id, pair_id, status, joins_phase) values (1, 9001, 'approved', 1)");
    const [card] = await myLeagueCards(asUser("x"), IN_ROUND_1);
    expect(card).toMatchObject({ place: null, joins: null, entry: { kind: "status", status: "approved", joinsPhase: 1 } });
  });

  it("between rounds: when the next one starts; before the groups are out: no summary", async () => {
    h.raw.exec("delete from matches; delete from group_pairs; delete from groups");
    member("solo");
    const [card] = await myLeagueCards(asUser("solo"), at("2026-11-05T12:00:00Z"));
    expect(card).toMatchObject({ round: { kind: "next", round: 1, startsOn: "november 9-én" }, summary: null });
  });

  it("a player in no league has no card; a league the player doesn't belong to has none either (404)", async () => {
    h.raw.exec("insert into users (id, email, name, level, consent_at) values ('n', 'n@titkos.example', 'Senki', 'halado', 1)");
    expect(await myLeagueCards(asUser("n"), IN_ROUND_1)).toEqual([]);
    expect(await myLeagueCards(asUser("u1011a"), IN_ROUND_1, "deb")).toEqual([]);
    expect(await myLeagueCards(asUser("u1011a"), IN_ROUND_1, "nincs-ilyen")).toEqual([]);
    expect(await myLeagueCards(asUser("u1011a"), IN_ROUND_1, "gyor")).toHaveLength(1);
    // /leagues/<slug>: the same card, or null (404); one league, no way back to several.
    expect(await myLeagueCard(asUser("u1011a"), "deb", IN_ROUND_1)).toBeNull();
    expect(await myLeagueCard(asUser("u1011a"), "gyor", IN_ROUND_1)).toMatchObject({ card: { league: { slug: "gyor" } }, several: false });
  });

  it("one card per league, the newest season first", async () => {
    h.raw
      .prepare(
        "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (2, 2, '2027 tavasz', ?, ?, '2027-02-01')",
      )
      .run(sec("2026-11-01T23:00:00Z"), sec("2027-01-31T22:59:00Z"));
    h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (2, 1, ?, ?)").run(sec("2027-01-31T23:00:00Z"), sec("2027-02-21T22:59:00Z"));
    h.raw.exec("insert into league_members (league_id, user_id, source) values (2, 'u1011a', 'chosen')");
    const cards = await myLeagueCards(asUser("u1011a"), IN_ROUND_1);
    expect(cards.map((c) => c.league.slug)).toEqual(["deb", "gyor"]);
    expect(await myLeagueCard(asUser("u1011a"), "gyor", IN_ROUND_1)).toMatchObject({ several: true });
    expect(cards[0]).toMatchObject({ pair: null, round: { kind: "next", round: 1 }, summary: null });
  });

  it("carries no email or phone, the partner's or anyone else's", async () => {
    played(1011, 1012, [
      [6, 1],
      [6, 2],
    ]);
    member("solo");
    for (const id of ["u1011a", "solo"]) {
      const text = JSON.stringify(await myLeagueCards(asUser(id), IN_ROUND_1));
      expect(text).not.toMatch(/@|titkos|\+36|3012345|3099988/);
    }
  });

  it("Párkereső (#398): one line with a pair; without one the listed seekers, with contact data only between two of them", async () => {
    member("solo");
    member("kata");
    // Kata switched it on under the new wording (D177).
    h.raw.exec("insert into partner_searches (league_id, user_id, seeking, listed) values (1, 'kata', 1, 1)");
    const [paired] = await myLeagueCards(asUser("u1011a"), IN_ROUND_1);
    expect(paired!.finder).toEqual({ kind: "paired" });
    let [card] = await myLeagueCards(asUser("solo"), IN_ROUND_1);
    expect(card!.finder).toMatchObject({ kind: "single", leagueId: 1, search: { seeking: false, listed: false }, seekers: [{ name: "Tag kata", contact: null }] });
    // No email or phone while the viewer isn't a seeker.
    expect(JSON.stringify(card)).not.toMatch(/@|titkos|\+36|3099988/);
    h.raw.exec("insert into partner_searches (league_id, user_id, seeking, listed) values (1, 'solo', 1, 1)");
    [card] = await myLeagueCards(asUser("solo"), IN_ROUND_1);
    expect(card!.finder).toMatchObject({ seekers: [{ name: "Tag kata", contact: { phone: "+36 30 999 8877", email: "kata@titkos.example" } }] });
    // The pair link becomes a full address in the route (withOrigin).
    expect(withOrigin(card!, "https://padelparbaj.hu").finder).toMatchObject({ link: expect.stringMatching(/^https:\/\/padelparbaj\.hu\/pair\/join\/[\w-]+$/) });
    expect(withOrigin(paired!, "https://padelparbaj.hu")).toBe(paired);
  });
});

describe("myLeaguesAction", () => {
  it("Csatlakozom joins a listed league; a bad request is 400", async () => {
    h.raw.exec("insert into users (id, email, name, level, consent_at) values ('n', 'n@titkos.example', 'Senki', 'halado', 1)");
    expect(await myLeaguesAction(asUser("n"), formOf({ intent: "join_league", league: "2" }))).toEqual({ season: 0, ok: true });
    expect(h.raw.prepare("select league_id from league_members where user_id = 'n'").all()).toEqual([{ league_id: 2 }]);
    await expect(myLeaguesAction(asUser("n"), formOf({ intent: "join_league", league: "99" }))).rejects.toMatchObject({ status: 400 });
    await expect(myLeaguesAction(asUser("n"), formOf({ intent: "nope" }))).rejects.toMatchObject({ status: 400 });
  });
});

function formOf(fields: Record<string, string>): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

// decisions.server.ts on a real SQLite with every migration applied
// (~/test/sqlite): the organizer's list of disputes and matches, one match
// with both versions and its log, and deciding or overriding it (#29). The
// fixture is the one of matches.server.test.ts; email is stubbed.
import { budapestTime } from "@padel-liga/rules";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

// No VAPID keys: notifications are stored, not pushed.
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({
  queueGroupsPublished: async () => {},
  queueSeasonEntryDecision: async () => {},
  queueMatchEmails: async (messages: any[]) => h.mails.push(...messages),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { MANY, addManyMatches, recordOn } = await import("~/test/many-matches");
const G = await import("~/lib/groups.server");
const M = await import("~/lib/matches.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const at = (day: string, hour: number, minute = 0) => budapestTime(day, hour, minute);

// The first season: phase 1 runs Mon 9 – Sun 29 Nov 2026 (Budapest, UTC+1).
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];
const DEADLINE = new Date((sec(PHASES[0]!) + 21 * 86400 - 60) * 1000);
const PUBLISHED = new Date("2026-11-08T08:00:00Z");
const NOW = at("2026-11-10", 11);

// 7 pairs, 4 + 3. Group 1 by seed: pairs 1, 2, 4, 3 (pair 4 approved first);
// its matches: week 1 1–3 and 2–4, week 2 1–4 and 2–3, week 3 1–2 and 4–3.
// Group 2: pairs 5, 6, 7; week 1 6–7 (5 rests), week 2 5–7, week 3 5–6.
const LEVELS: [string, string][] = [
  ["versenyzo", "versenyzo"],
  ["versenyzo", "halado"],
  ["halado", "halado"],
  ["halado", "halado"],
  ["halado", "kozephalado"],
  ["kozephalado", "kozephalado"],
  ["kozephalado", "kezdo"],
];

async function freshDb() {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('pecs', 'Pécs', 1)`);
  h.raw.exec(`insert into clubs (id, slug, city, name, active) values (1, 'ace', 'gyor', 'Ace Padel', 1), (2, 'old', 'gyor', 'Régi Klub', 0), (3, 'pecsi', 'pecs', 'Pécsi Padel', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)")
      .run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('o', 'o@x.hu', 'Org', 'versenyzo', 1)`);
  LEVELS.forEach((levels, i) => {
    const id = i + 1;
    for (const side of ["a", "b"] as const)
      h.raw
        .prepare("insert into users (id, email, name, level, phone, consent_at) values (?, ?, ?, ?, ?, 1)")
        .run(`p${id}${side}`, `p${id}${side}@x.hu`, `Játékos ${id}${side.toUpperCase()}`, levels[side === "a" ? 0 : 1], `+3630${id}00000${side === "a" ? 1 : 2}`);
    h.raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)").run(id, `p${id}a`, `p${id}b`);
    h.raw
      .prepare("insert into season_entries (season_id, pair_id, status, joins_phase, decided_at) values (1, ?, 'approved', 1, ?)")
      .run(id, sec("2026-11-06T10:00:00Z") + (id === 4 ? 0 : id + 10));
  });
  h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('x', 'x@x.hu', 'Kívülálló', 'halado', 1)`);
  expect(await G.generateDraft(1, "o")).toEqual({ ok: true });
  expect(await G.publishGroups(1, "o", PUBLISHED)).toEqual({ ok: true });
  h.raw.exec("delete from notifications");
  h.mails = [];
}

const all = (q: string, ...params: unknown[]) => h.raw.prepare(q).all(...params);
const matchOf = (a: number, b: number): number =>
  all("select id from matches where (pair_a = ? and pair_b = ?) or (pair_a = ? and pair_b = ?)", a, b, b, a)[0].id;
const inbox = () => all("select n.kind, n.url, u.id as user from notifications n join users u on u.id = n.user_id order by n.id");
const events = (matchId: number) => all("select kind, pair_id, user_id, slots, slot, club_id from match_events where match_id = ? order by id", matchId);

const R = await import("~/lib/results.server");
const D = await import("~/lib/decisions.server");

type Score = { sets: [number, number][]; superTieBreak?: [number, number] };
const WIN: Score = { sets: [[4, 1], [4, 2]] };
const LOSS: Score = { sets: [[1, 4], [2, 4]] };
const PLAYED = at("2026-11-12", 20);
const LATER = at("2026-11-14", 9);
const matchRow = (id: number) => all("select status, outcome, revision, pair_a from matches where id = ?", id)[0];
const decisions = (id: number) => all("select kind, user_id, outcome, reason, at from match_decisions where match_id = ? order by id", id);

// Match 1–3, recorded by pair_a, disputed by pair_b.
async function disputed() {
  const id = matchOf(1, 3);
  const a = matchRow(id).pair_a as number;
  const b = a === 1 ? 3 : 1;
  await R.resultStep(`p${a}a`, id, { kind: "record", clubId: 1, score: WIN }, PLAYED);
  await R.resultStep(`p${b}b`, id, { kind: "dispute", score: LOSS, note: "Fordítva volt." }, PLAYED);
  h.raw.exec("delete from notifications");
  return { id, a, b };
}

// A second league with its own published match, for the cross-league checks.
function otherLeagueMatch(): number {
  h.raw.exec(`insert into leagues (id, city, slug, name) values (2, 'pecs', 'pecs', 'Padelpárbaj Pécs')`);
  h.raw.exec(`insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (2, 2, 'Pécs tél', 1, 2, '2026-11-09')`);
  h.raw.exec(`insert into groups (id, season_id, phase, number, published_at) values (99, 2, 1, 1, 1)`);
  h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (99, 5, 1), (99, 6, 2)`);
  h.raw.exec(`insert into matches (id, group_id, pair_a, pair_b, week, deadline) values (999, 99, 5, 6, 1, ${Math.floor(DEADLINE.getTime() / 1000)})`);
  return 999;
}

describe("the league's disputes and matches (#29 requirement 1)", () => {
  beforeEach(freshDb);

  it("lists the disputed result with both pairs' versions, and every match with its status", async () => {
    const { id, a, b } = await disputed();
    const { disputes, matches } = await D.leagueMatches(1);
    expect(disputes).toHaveLength(1);
    const names = (p: number) => `Játékos ${p}A – Játékos ${p}B`;
    expect(disputes[0]).toMatchObject({
      id,
      a: names(a),
      b: names(b),
      recordedBy: names(a),
      recorded: "4:1, 4:2",
      disputedBy: names(b),
      counter: "1:4, 2:4",
      label: "Vitatott eredmény",
      recordedBySide: "a",
    });
    // The players by id, for the Admin's links to their profiles (#301).
    expect(disputes[0]!.players.a.map((p) => p.name)).toEqual([`Játékos ${a}A`, `Játékos ${a}B`]);
    expect(disputes[0]!.players.b.every((p) => typeof p.id === "string" && p.id.length > 0)).toBe(true);
    // 6 + 3 matches of the two published groups, in group and week order.
    expect(matches).toHaveLength(9);
    expect(matches.map((m) => [m.groupNumber, m.week])).toEqual([...matches.map((m) => [m.groupNumber, m.week])].sort((x, y) => x[0]! - y[0]! || x[1]! - y[1]!));
    expect(matches.filter((m) => m.label === "Egyeztetés alatt")).toHaveLength(8);
    // No contact details.
    expect(JSON.stringify({ disputes, matches })).not.toMatch(/@|\+36/);
  });

  it("more matches than one D1 statement can bind: all listed, with names and results", async () => {
    const ids = addManyMatches(h.raw, DEADLINE);
    const last = ids.at(-1)!;
    recordOn(h.raw, last, WIN, PLAYED);
    h.raw
      .prepare("insert into match_events (match_id, pair_id, user_id, kind, score, at) values (?, ?, ?, 'result_disputed', ?, ?)")
      .run(last, 2 * last + 1, `m${2 * last + 1}a`, JSON.stringify(LOSS), Math.floor(LATER.getTime() / 1000));
    const { disputes, matches } = await D.leagueMatches(1);
    expect(matches).toHaveLength(9 + MANY);
    expect(matches.find((m) => m.id === ids[0])).toMatchObject({ a: `Sok ${2 * ids[0]!}A – Sok ${2 * ids[0]!}B`, label: "Egyeztetés alatt" });
    expect(disputes.map((d) => [d.id, d.recorded, d.counter])).toEqual([[last, "4:1, 4:2", "1:4, 2:4"]]);
  });

  it("another league's matches are not listed", async () => {
    otherLeagueMatch();
    expect((await D.leagueMatches(1)).matches.map((m) => m.id)).not.toContain(999);
    expect((await D.leagueMatches(2)).matches.map((m) => m.id)).toEqual([999]);
  });
});

describe("one match for the organizer (#29)", () => {
  beforeEach(freshDb);

  it("both versions, the note and the full log in match order", async () => {
    const { id } = await disputed();
    const page = (await D.decisionPage(1, id))!;
    expect(page.result).toMatchObject({ status: "disputed" });
    expect(page.note).toBe("Fordítva volt.");
    expect(page.players.a).toHaveLength(2);
    // Each step names who did it, by id too (the Admin's link, #301).
    expect(page.log.every((l) => l.whoId !== undefined)).toBe(true);
    expect(page.log.filter((l) => l.role !== "automatikus").every((l) => typeof l.whoId === "string")).toBe(true);
    expect(page.current).toEqual({ kind: "played", score: WIN });
    expect(page.log.map((l) => [l.role, l.text])).toEqual([
      ["1. pár", "Rögzítette az eredményt: 4:1, 4:2"],
      ["2. pár", "Vitatta az eredményt, ezt írta be helyette: 1:4, 2:4. Megjegyzés: Fordítva volt."],
    ]);
    expect(JSON.stringify(page)).not.toMatch(/@|\+36/);
  });

  it("a match of another league is not found under this league", async () => {
    const other = otherLeagueMatch();
    expect(await D.decisionPage(1, other)).toBeNull();
    expect(await D.decisionPage(2, matchOf(1, 3))).toBeNull();
    expect(await D.decisionPage(1, 12345)).toBeNull();
  });
});

describe("deciding and overriding (#29 requirements 2-5)", () => {
  beforeEach(freshDb);

  it("the organizer settles a dispute: final for both pairs, logged with who, when and why, both pairs told", async () => {
    const { id, a, b } = await disputed();
    const decided = { kind: "played", score: { sets: [[4, 1], [2, 4]], superTieBreak: [10, 8] } } as const;
    expect(await D.decideMatch("o", 1, id, decided, "  Mindkét pár képet küldött a táblázatról.  ", LATER)).toEqual({
      ok: true,
      notice: "Elmentettük a döntést. Mindkét pár értesítést kap.",
    });
    expect(matchRow(id)).toMatchObject({ status: "final", outcome: JSON.stringify(decided) });
    expect(decisions(id)).toEqual([
      { kind: "organizer", user_id: "o", outcome: JSON.stringify(decided), reason: "Mindkét pár képet küldött a táblázatról.", at: Math.floor(LATER.getTime() / 1000) },
    ]);
    // Both pairs: in the app (and by push), a digest kind; no email.
    expect(
      inbox()
        .map((n: any) => [n.kind, n.user])
        .sort(),
    ).toEqual([`p${a}a`, `p${a}b`, `p${b}a`, `p${b}b`].map((u) => ["match_decided", u]).sort());
    expect(h.mails.filter((m) => m.kind !== "match_result")).toEqual([]);
    // The players see the final result, the decision in the log.
    const page = (await M.matchPage(id, `p${b}a`, LATER))!;
    expect(page.result).toMatchObject({ status: "final", how: "organizer", outcome: decided });
    expect(page.log.at(-1)).toMatchObject({
      who: "Org",
      by: "organizer",
      text: "A szervező döntött: 1:4, 4:2, szuper tie-break 8:10 (kikaptatok). Indoklás: Mindkét pár képet küldött a táblázatról.",
    });
    expect((await D.leagueMatches(1)).disputes).toEqual([]);
  });

  it("an override without a reason is refused, nothing written", async () => {
    const id = matchOf(1, 3);
    expect(await D.decideMatch("o", 1, id, { kind: "walkover", winner: "a" }, "   ", LATER)).toEqual({
      ok: false,
      error: "Írd meg az indoklást: a döntés a meccs naplójába kerül.",
    });
    expect(await D.decideMatch("o", 1, id, { kind: "played", score: { sets: [[4, 3], [4, 0]] } }, "ok", LATER)).toMatchObject({ ok: false });
    expect(decisions(id)).toEqual([]);
    expect(matchRow(id).status).toBe("open");
    expect(inbox()).toEqual([]);
  });

  it("any match can be overridden, played or not; the latest decision counts and every one is logged", async () => {
    const id = matchOf(1, 3);
    const a = matchRow(id).pair_a as number;
    const b = a === 1 ? 3 : 1;
    await R.resultStep(`p${a}a`, id, { kind: "record", clubId: 1, score: WIN }, PLAYED);
    await R.resultStep(`p${b}a`, id, { kind: "confirm" }, PLAYED);
    expect((await D.decideMatch("o", 1, id, { kind: "walkover", winner: "b" }, "Nem jelent meg az 1. pár.", LATER)).ok).toBe(true);
    expect((await D.decideMatch("o", 1, id, { kind: "unplayed" }, "Mégis elmaradt.", new Date(LATER.getTime() + 60_000))).ok).toBe(true);
    expect(matchRow(id)).toMatchObject({ status: "final", outcome: JSON.stringify({ kind: "unplayed" }) });
    expect(decisions(id).map((d: any) => [d.kind, d.user_id, d.reason])).toEqual([
      ["organizer", "o", "Nem jelent meg az 1. pár."],
      ["organizer", "o", "Mégis elmaradt."],
    ]);
    const page = (await D.decisionPage(1, id))!;
    expect(page.label).toBe("Döntés: Elmaradt: nem számít bele a tabellába");
    expect(page.log.slice(-2).map((l) => [l.who, l.role, l.text])).toEqual([
      ["Org", "szervező", `Döntés: Játék nélküli győzelem: Játékos ${b}A – Játékos ${b}B (4:0, 4:0). Indoklás: Nem jelent meg az 1. pár.`],
      ["Org", "szervező", "Döntés: Elmaradt: nem számít bele a tabellába. Indoklás: Mégis elmaradt."],
    ]);

    // A match nobody touched: both inactive.
    const untouched = matchOf(2, 4);
    expect((await D.decideMatch("o", 1, untouched, { kind: "both-inactive" }, "Senki nem egyeztetett.", LATER)).ok).toBe(true);
    expect(matchRow(untouched).status).toBe("final");
    // After a decision the players take no more steps.
    const p = (await M.matchPage(untouched, "p2a", LATER))!;
    expect(p.resultActions).toEqual({ record: false, confirm: false, dispute: false });
    expect(p.actions.propose).toBe(false);
  });

  it("a match of another league can't be changed through this league (hand-made request)", async () => {
    const other = otherLeagueMatch();
    expect(await D.decideMatch("o", 1, other, { kind: "unplayed" }, "x", LATER)).toEqual({
      ok: false,
      error: "Nincs ilyen meccs ebben a ligában.",
      notFound: true,
    });
    expect(await D.decideMatch("o", 2, matchOf(1, 3), { kind: "unplayed" }, "x", LATER)).toMatchObject({ ok: false, notFound: true });
    expect(decisions(other)).toEqual([]);
    expect(decisions(matchOf(1, 3))).toEqual([]);
  });

  it("a decision is not auto-accepted over", async () => {
    const id = matchOf(1, 3);
    const a = matchRow(id).pair_a as number;
    await R.resultStep(`p${a}a`, id, { kind: "record", clubId: 1, score: WIN }, PLAYED);
    await D.decideMatch("o", 1, id, { kind: "walkover", winner: "a" }, "A napló alapján.", LATER);
    expect(await R.autoAcceptResults(new Date(PLAYED.getTime() + 100 * 3600_000))).toBe(0);
    expect(decisions(id)).toHaveLength(1);
  });
});

void vi;
void budapestTime;

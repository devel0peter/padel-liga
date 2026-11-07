// Profiles are for logged-in members only (D112, #36), on a real SQLite
// (~/test/sqlite) with the real session lookup: a visitor goes to the login
// page and comes back, an account mid first-login goes to /welcome, a member
// gets the page. The public league page links a pair's name to its profile
// for a member only, and shows no rating to anyone.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({}));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const Player = await import("~/routes/player-profile");
const Pair = await import("~/routes/pair-profile");
const League = await import("~/routes/league");
const { SidebarProvider } = await import("~/components/ui/sidebar");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

const args = (path: string, params: Record<string, string>, cookie?: string) =>
  ({ request: new Request(`http://localhost${path}`, { headers: cookie ? { Cookie: cookie } : {} }), params, context: {} }) as any;

// What a loader threw (a redirect or a 404), or what it returned.
const outcome = (p: Promise<unknown>) => p.catch((e: unknown) => e);

async function thrown(p: Promise<unknown>): Promise<Response> {
  const e = await outcome(p);
  expect(e).toBeInstanceOf(Response);
  return e as Response;
}

const cookieFor = async (id: string) => (await createSession(id)).split(";")[0]!;

let member: string;
let midFirstLogin: string;

beforeEach(async () => {
  // Round 1 has started: results and ratings would show on a profile.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T10:00:00Z"));
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  h.raw
    .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?)")
    .run(sec("2026-11-08T23:00:00Z"), sec("2026-11-29T22:59:00Z"));
  // Players: Anna's pair (1) and two more; "mid" has not finished the first-login page (no sex yet).
  const people: [string, string, string | null][] = [
    ["ua", "Kis Anna", "female"],
    ["ub", "Nagy Bea", "female"],
    ["uc", "Tóth Cili", "female"],
    ["ud", "Szabó Dóra", "female"],
    ["ue", "Varga Emma", "female"],
    ["uf", "Kovács Flóra", "female"],
    ["mid", "Új Ede", null],
  ];
  for (const [id, name, sex] of people)
    h.raw
      .prepare("insert into users (id, email, name, phone, level, elo, sex, consent_at) values (?, ?, ?, '+36301234567', 'halado', 1412.4, ?, 1)")
      .run(id, `${id}@titkos.example`, name, sex);
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'ua', 'ub'), (2, 1, 'uc', 'ud'), (3, 1, 'ue', 'uf')`);
  h.raw.prepare("insert into groups (id, season_id, phase, number, published_at) values (1, 1, 1, 1, ?)").run(sec("2026-11-06T10:00:00Z"));
  h.raw.exec(`insert into group_pairs (group_id, pair_id, seed) values (1, 1, 1), (1, 2, 2), (1, 3, 3)`);
  h.raw
    .prepare("insert into matches (group_id, pair_a, pair_b, week, deadline, status, outcome) values (1, 1, 2, 1, ?, 'final', ?)")
    .run(sec("2026-11-29T22:59:00Z"), JSON.stringify({ kind: "played", score: { sets: [[4, 1], [4, 2]] } }));
  member = await cookieFor("uc");
  midFirstLogin = await cookieFor("mid");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("profiles: logged-in members only (D112)", () => {
  it("a visitor without a session goes to the login page and comes back to the profile", async () => {
    const player = await thrown(Player.loader(args("/players/ua", { id: "ua" })));
    expect(player.status).toBe(302);
    expect(player.headers.get("Location")).toBe("/login?returnTo=%2Fplayers%2Fua");
    const pair = await thrown(Pair.loader(args("/pairs/1", { id: "1" })));
    expect(pair.status).toBe(302);
    expect(pair.headers.get("Location")).toBe("/login?returnTo=%2Fpairs%2F1");
  });

  it("a visitor learns nothing about which ids exist: an unknown one redirects the same way", async () => {
    const player = await thrown(Player.loader(args("/players/nincs", { id: "nincs" })));
    expect(player.headers.get("Location")).toBe("/login?returnTo=%2Fplayers%2Fnincs");
    const pair = await thrown(Pair.loader(args("/pairs/999", { id: "999" })));
    expect(pair.headers.get("Location")).toBe("/login?returnTo=%2Fpairs%2F999");
  });

  it("an account mid first-login goes to /welcome, like on every other logged-in page", async () => {
    const player = await thrown(Player.loader(args("/players/ua", { id: "ua" }, midFirstLogin)));
    expect(player.headers.get("Location")).toBe("/welcome?returnTo=%2Fplayers%2Fua");
    const pair = await thrown(Pair.loader(args("/pairs/1", { id: "1" }, midFirstLogin)));
    expect(pair.headers.get("Location")).toBe("/welcome?returnTo=%2Fpairs%2F1");
  });

  it("a logged-in member gets the player's and the pair's page, results and rating included", async () => {
    const player: any = await Player.loader(args("/players/ua", { id: "ua" }, member));
    expect(player).toMatchObject({ player: { id: "ua", name: "Kis Anna" }, started: true });
    expect(player.elo).toEqual(expect.any(Number));
    expect(player.matches).toHaveLength(1);
    const pair: any = await Pair.loader(args("/pairs/1", { id: "1" }, member));
    expect(pair).toMatchObject({ pair: { id: 1 }, started: true });
    expect(pair.matches).toHaveLength(1);
    // Still no contact data for a member either.
    expect(JSON.stringify([player, pair])).not.toMatch(/titkos\.example|\+36/);
  });

  it("an unknown pair or player is still a 404 for a member", async () => {
    expect((await thrown(Player.loader(args("/players/nincs", { id: "nincs" }, member)))).status).toBe(404);
    expect((await thrown(Pair.loader(args("/pairs/999", { id: "999" }, member)))).status).toBe(404);
  });

  it("asks search engines not to index them and has no link preview", () => {
    for (const tags of [
      Player.meta({ loaderData: { player: { name: "Kis Anna" } } } as any),
      Pair.meta({ loaderData: { pair: { id: 1, players: [{ name: "Kis Anna" }, { name: "Nagy Bea" }] } } } as any),
    ]) {
      expect(tags).toContainEqual({ name: "robots", content: "noindex, nofollow" });
      expect(JSON.stringify(tags)).not.toMatch(/og:|twitter:|canonical|description/);
    }
  });
});

describe("league page: logged-in players only (D134), no rating (D112)", () => {
  async function render(cookie: string): Promise<{ html: string; data: unknown }> {
    const data = await League.loader(args("/league/gyor", { league: "gyor" }, cookie));
    // In the app shell (D134): AppPage needs the sidebar's context.
    const Page = () => createElement(SidebarProvider, null, createElement(League.default, { loaderData: data } as any));
    const Stub = createRoutesStub([{ path: "/league/gyor", Component: Page }]);
    return { html: renderToStaticMarkup(createElement(Stub, { initialEntries: ["/league/gyor"] })), data };
  }

  it("a visitor goes to the login page and comes back, for an unknown league too", async () => {
    const page = await thrown(League.loader(args("/league/gyor", { league: "gyor" })));
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toBe("/login?returnTo=%2Fleague%2Fgyor");
    const unknown = await thrown(League.loader(args("/league/nincs", { league: "nincs" })));
    expect(unknown.headers.get("Location")).toBe("/login?returnTo=%2Fleague%2Fnincs");
  });

  it("an account mid first-login finishes it first", async () => {
    const page = await thrown(League.loader(args("/league/gyor", { league: "gyor" }, midFirstLogin)));
    expect(page.status).toBe(302);
    expect(page.headers.get("Location")).toMatch(/^\/welcome/);
  });

  it("a logged-in player sees the names, the results and each pair's name as a link to its profile", async () => {
    const { html, data } = await render(member);
    expect(data).toMatchObject({ kind: "ladder" });
    expect(html).toContain("Kis Anna");
    for (const id of [1, 2, 3]) expect(html).toContain(`href="/pairs/${id}"`);
  });

  it("shows no rating: none in the page or its data", async () => {
    const { html, data } = await render(member);
    expect(html).not.toMatch(/Élő-pont|1412/i);
    expect(JSON.stringify(data)).not.toMatch(/"elo"|1412/);
  });
});


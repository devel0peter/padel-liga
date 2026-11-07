// Kezdőlap's league card (D128, #331) on a real SQLite (~/test/sqlite), with
// the real session lookup: a player in no league is asked to choose one; a
// logged-in visitor who came through a league's register button
// (`/home?league=<slug>`) is offered that league, and only "Csatlakozom" (a
// POST) joins it. Email sending is stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({ MAX_BATCH: 100, relayConfigured: () => false, sendEmails: async () => [] }));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const Home = await import("~/routes/app.home");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const all = (q: string) => h.raw.prepare(q).all();
const args = (url: string, cookie: string, init: RequestInit = {}) =>
  ({ request: new Request(url, { ...init, headers: { Cookie: cookie } }), params: {}, context: {} }) as any;
const join = (cookie: string, league: number) =>
  Home.action(args("http://localhost/home", cookie, { method: "POST", body: new URLSearchParams({ intent: "join_league", league: String(league) }) }));

async function redirectOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e: any) {
    return e instanceof Response ? e.headers.get("Location") : null;
  }
}

let cookie = "";
beforeEach(async () => {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('mmo', 'Mosonmagyaróvár', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'mmo', 'ovar', 'Padelpárbaj Óvár')`);
  // Győr has a running season; Óvár none yet.
  h.raw
    .prepare("insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, 'Tél', ?, ?, '2026-11-09')")
    .run(sec("2026-10-28T23:00:00Z"), sec("2026-11-08T22:59:00Z"));
  h.raw.prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, 1, ?, ?)").run(sec("2026-11-08T23:00:00Z"), sec("2030-11-29T22:59:00Z"));
  h.raw.exec(`insert into users (id, email, name, level, phone, sex, consent_at) values ('a', 'a@x.hu', 'Anna', 'kezdo', '+36301234567', 'female', 1)`);
  cookie = (await createSession("a")).split(";")[0]!;
});

describe("Melyik ligában játszol? (#331)", () => {
  it("asks a player in no league, offering the leagues with a season open or running; Csatlakozom joins", async () => {
    const page: any = await Home.loader(args("http://localhost/home", cookie));
    expect(page.choices).toEqual([{ id: 1, city: "Győr", name: "Padelpárbaj Győr" }]);
    expect(page.offered).toBe(false);
    expect(await join(cookie, 1)).toEqual({ season: 0, ok: true });
    expect(all("select league_id, source from league_members")).toEqual([{ league_id: 1, source: "chosen" }]);
    expect((await Home.loader(args("http://localhost/home", cookie)) as any).choices).toEqual([]);
  });
});

describe("the register button's league while logged in (D128)", () => {
  it("offers that league, and joins nothing on the GET", async () => {
    h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'a', 'register')`);
    const page: any = await Home.loader(args("http://localhost/home?league=ovar", cookie));
    expect(page.choices).toEqual([{ id: 2, city: "Mosonmagyaróvár", name: "Padelpárbaj Óvár" }]);
    expect(page.offered).toBe(true);
    expect(all("select league_id from league_members order by league_id")).toEqual([{ league_id: 1 }]);
    // Csatlakozom joins; then the address is cleaned up.
    expect(await join(cookie, 2)).toEqual({ season: 0, ok: true });
    expect(all("select league_id from league_members order by league_id")).toEqual([{ league_id: 1 }, { league_id: 2 }]);
    expect(await redirectOf(Home.loader(args("http://localhost/home?league=ovar", cookie)))).toBe("/home");
  });

  it("drops an unknown or odd league from the address", async () => {
    expect(await redirectOf(Home.loader(args("http://localhost/home?league=nincs", cookie)))).toBe("/home");
    expect(await redirectOf(Home.loader(args("http://localhost/home?league=%2F%2Fx", cookie)))).toBe("/home");
    expect(all("select * from league_members")).toEqual([]);
  });
});

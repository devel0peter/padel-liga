// The landing page on a real SQLite (~/test/sqlite). The line after a player
// deleted their own account (#38): only for a visitor without a session, so
// a link with ?accountDeleted=1 can't tell a logged-in player their account
// is gone. Without the interest form (#332, D123): a post of the old form is
// refused and stores nothing, and only cities with a league are listed, a
// waiting first season with its missing entries (#335, D124). Email is
// stubbed and stays unused.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, mails: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/outbox.server", () => ({}));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const H = await import("~/routes/home");

const load = (path: string, cookie?: string) =>
  H.loader({ request: new Request(`http://localhost${path}`, { headers: cookie ? { Cookie: cookie } : {} }), params: {}, context: {} } as any);

describe("Kezdőlap: after Fiók törlése (#38)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.raw.exec(`insert into users (id, email, name, consent_at) values ('u', 'u@x.hu', 'Kis Anna', 1)`);
  });

  it("shows the line to a visitor without a session", async () => {
    expect(await load("/?accountDeleted=1")).toMatchObject({ accountDeleted: true });
    expect(await load("/")).toMatchObject({ accountDeleted: false });
  });

  it("never to someone logged in", async () => {
    const cookie = (await createSession("u")).split(";")[0]!;
    expect(await load("/?accountDeleted=1", cookie)).toMatchObject({ accountDeleted: false });
  });
});

const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
const count = (table: string) => h.raw.prepare(`select count(*) n from ${table}`).get().n;

describe("the landing page without the interest form (#332)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.mails = [];
  });

  it("refuses a post of the old interest form and stores nothing", async () => {
    const before = { signups: count("interest_signups"), mail: count("email_messages") };
    const form = new FormData();
    for (const [k, v] of Object.entries({
      city: "other",
      cityOther: "Tesztfalva",
      name1: "Teszt Elek",
      email1: "teszt@example.test",
      level: "halado",
      organize: "on",
      consent: "on",
    }))
      form.append(k, v);
    const result: any = await H.action(args(new Request("http://localhost/", { method: "POST", body: form })));
    expect(result.init?.status).toBe(410);
    expect(result.data).toEqual({ error: H.INTEREST_CLOSED });
    expect(H.INTEREST_CLOSED).toContain("hello@padelparbaj.hu");
    expect({ signups: count("interest_signups"), mail: count("email_messages") }).toEqual(before);
    expect(h.mails).toEqual([]);
  });

  it("old links with ?ref= still open it", async () => {
    const data = await H.loader(args(new Request("http://localhost/?ref=fb-csoport")));
    expect(data.ref).toBe("fb-csoport");
  });

  it("lists only listed cities with a league; a waiting first season shows the entries still needed (#335)", async () => {
    h.raw.exec(`insert or ignore into cities (slug, name, listed) values ('uj', 'Újváros', 1), ('ures', 'Üresváros', 1)`);
    h.raw.exec(`delete from leagues`);
    h.raw.exec(`insert into leagues (id, city, slug, name, min_entries) values (1, 'uj', 'uj', 'Padelpárbaj Újváros', 12)`);
    h.raw.exec(
      `insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start, starts_at_minimum)
       values (1, 1, 'Első', unixepoch() - 3600, unixepoch() - 3600, '', 1)`,
    );
    h.raw.exec(`insert into users (id, email, name, level, consent_at) values ('a', 'a@x.hu', 'A', 'halado', 1), ('b', 'b@x.hu', 'B', 'halado', 1)`);
    h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b')`);
    h.raw.exec(`insert into season_entries (season_id, pair_id, status, joins_phase) values (1, 1, 'approved', 1)`);
    const data = await H.loader(args(new Request("http://localhost/")));
    expect(data.cities.map((c) => c.slug)).toEqual(["uj"]);
    expect(data.cities[0]!.league.facts).toEqual([["Indulás", "1 pár nevezett, még 11 kell, utána indul."]]);
    expect(JSON.stringify(data)).not.toMatch(/jelentkez/);
  });
});

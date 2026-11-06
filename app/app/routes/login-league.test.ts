// The landing page's register button carries its league through login (D127,
// #331): /register?league=<slug> puts it in returnTo, and the login with the
// code joins the account to that league at once, also before the first-login
// page is done. Real SQLite (~/test/sqlite); the code check is stubbed.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: { GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", TURNSTILE_SITE_KEY: "" } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
// Nothing is mailed here.
vi.mock("~/lib/email/outbox.server", () => ({}));
vi.mock("~/lib/auth/login-code.server", () => ({
  sendLoginCode: async () => ({ ok: true, email: "n@x.hu" }),
  verifyLoginCode: async (email: string, code: string) => (code === "123456" ? { ok: true, userId: "n" } : { ok: false, error: "Hibás kód." }),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const R = await import("~/routes/login");

const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
const all = (q: string) => h.raw.prepare(q).all();

async function verify(returnTo: string, code = "123456") {
  const body = new URLSearchParams({ email: "n@x.hu", code, returnTo, intent: "verify" });
  return R.action(args(new Request("http://localhost/register", { method: "POST", body })));
}

beforeEach(() => {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('mmo', 'Mosonmagyaróvár', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'mmo', 'ovar', 'Padelpárbaj Óvár')`);
  // A new account: the first-login page is still ahead.
  h.raw.exec(`insert into users (id, email, name) values ('n', 'n@x.hu', '')`);
});

describe("the register button's league through login (D127, #331)", () => {
  it("puts the league in returnTo, so it survives the code step, Google and the first-login page", async () => {
    const page = (await R.loader(args(new Request("http://localhost/register?league=ovar")))) as any;
    expect(page.returnTo).toBe("/home?league=ovar");
    // An odd value is dropped, not passed on.
    const odd = (await R.loader(args(new Request("http://localhost/register?league=%2F%2Fevil")))) as any;
    expect(odd.returnTo).toBe("/home");
  });

  it("joins that league, and only that one, as soon as the code is right", async () => {
    const res = (await verify("/home?league=ovar")) as Response;
    expect(res.headers.get("Location")).toBe("/home?league=ovar");
    expect(all("select league_id, user_id, source from league_members")).toEqual([{ league_id: 2, user_id: "n", source: "register" }]);
  });

  it("joins nothing without a league, with an unknown one or a wrong code", async () => {
    await verify("/home");
    await verify("/home?league=nincs");
    await verify("/home?league=gyor", "000000");
    expect(all("select * from league_members")).toEqual([]);
  });
});

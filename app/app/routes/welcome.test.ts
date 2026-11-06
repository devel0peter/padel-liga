// The first-login page ("Üdv!") on a real SQLite (~/test/sqlite), with the
// real session lookup: nothing comes from the interest list any more (#333,
// D128), and Férfi or Nő is asked (#133). The sender is stubbed and records
// what it gets; nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, sent: [] as any[] }));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/background.server", () => import("~/test/background"));
vi.mock("~/lib/cities.server", () => ({
  listedCities: async () => [{ slug: "gyor" }, { slug: "pecs" }],
  listCities: async () => [{ slug: "gyor", name: "Győr" }],
}));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async (emails: any[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
  },
}));

const { migratedDatabase } = await import("~/test/sqlite");
const { settleBackground } = await import("~/test/background");
const { createSession } = await import("~/lib/auth/session.server");
const R = await import("~/routes/welcome");
const P = await import("~/routes/profile");
const { requireUser } = await import("~/lib/auth/session.server");

const URL_ = "http://localhost/welcome";
const args = (request: Request) => ({ request, params: {}, context: {} }) as any;
const get = (cookie: string) => new Request(URL_, { headers: { Cookie: cookie } });
const post = (cookie: string, fields: Record<string, string>) =>
  new Request(URL_, { method: "POST", headers: { Cookie: cookie }, body: new URLSearchParams(fields) });
const all = (q: string, ...p: any[]) => h.raw.prepare(q).all(...p);

// A first login: the account exists (code login: no name; Google: its name),
// the first-login page isn't done.
async function firstLogin(email: string, name = ""): Promise<string> {
  const id = email.split("@")[0]!;
  h.raw.prepare("insert into users (id, email, name) values (?, ?, ?)").run(id, email, name);
  return (await createSession(id)).split(";")[0]!;
}

function signup(v: { mode?: "pair" | "solo"; name1: string; email1: string; name2?: string; email2?: string; level?: string }) {
  h.raw
    .prepare("insert into interest_signups (mode, name1, email1, name2, email2, city, level, consent_at) values (?, ?, ?, ?, ?, 'gyor', ?, 1)")
    .run(v.mode ?? "pair", v.name1, v.email1, v.name2 ?? null, v.email2 ?? null, v.level ?? "kezdo");
}

async function redirectOf(p: Promise<unknown>): Promise<string | null> {
  try {
    const r = await p;
    return r instanceof Response ? r.headers.get("Location") : null;
  } catch (e: any) {
    return e instanceof Response ? e.headers.get("Location") : null;
  }
}

describe("first-login page without the interest list (#333)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
    h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
    h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  });

  it("takes no name, level or partner from a signup", async () => {
    signup({ name1: "Nagy Anna", email1: "anna@x.hu", name2: "Kovács Béla", level: "halado" });
    const d = await R.loader(args(get(await firstLogin("anna@x.hu"))));
    expect(d).toEqual({ onlySex: false, name: "", level: null, email: "anna@x.hu", phone: "", returnTo: "/home" });
  });

  it("keeps the Google name", async () => {
    const d = await R.loader(args(get(await firstLogin("anna@x.hu", "Nagy Anna Google"))));
    expect(d).toMatchObject({ name: "Nagy Anna Google", level: null });
  });

  it("forms no pair from a signup when both partners have registered", async () => {
    signup({ name1: "Nagy Anna", email1: "anna@x.hu", name2: "Kovács Béla", email2: "bela@x.hu", level: "halado" });
    const done = { name: "Nagy Anna", level: "halado", phone: "+36 30 123 4567", consent: "on", sex: "female", returnTo: "/home" };
    expect(await redirectOf(R.action(args(post(await firstLogin("anna@x.hu"), done))))).toBe("/home");
    expect(await redirectOf(R.action(args(post(await firstLogin("bela@x.hu"), done))))).toBe("/home");
    await settleBackground();
    expect(all("select * from pairs")).toEqual([]);
    expect(all("select * from email_messages")).toEqual([]);
    expect(h.sent).toEqual([]);
  });
});

describe("Férfi or Nő (#133)", () => {
  beforeEach(() => {
    h.raw = migratedDatabase();
    h.sent = [];
  });
  const profile = { name: "Nagy Anna", level: "halado", phone: "+36 30 123 4567", consent: "on", returnTo: "/home" };
  const row = (id: string) => h.raw.prepare("select sex, consent_at is not null as done from users where id = ?").get(id);

  it("can't finish the first login without choosing, and takes no other value", async () => {
    const cookie = await firstLogin("anna@x.hu");
    for (const sex of [undefined, "", "other", "Nő"]) {
      const fields: Record<string, string> = sex === undefined ? profile : { ...profile, sex };
      expect(await R.action(args(post(cookie, fields))), String(sex)).toEqual({ errors: { sex: "Válaszd ki: férfi vagy nő." } });
    }
    expect(row("anna")).toEqual({ sex: null, done: 0 });
    expect(await redirectOf(R.action(args(post(cookie, { ...profile, sex: "female" }))))).toBe("/home");
    expect(row("anna")).toEqual({ sex: "female", done: 1 });
  });

  it("asks an existing account once, then sends it on where it was going", async () => {
    h.raw.prepare("insert into users (id, email, name, level, phone, consent_at) values ('old', 'old@x.hu', 'Régi Ödön', 'halado', '+36301234567', 1)").run();
    const cookie = (await createSession("old")).split(";")[0]!;
    const pair = new Request("http://localhost/pair", { headers: { Cookie: cookie } });
    expect(await redirectOf(requireUser(pair))).toBe("/welcome?returnTo=%2Fpair");
    const page = await R.loader(args(new Request("http://localhost/welcome?returnTo=%2Fpair", { headers: { Cookie: cookie } })));
    expect(page).toEqual({ onlySex: true, returnTo: "/pair" });
    expect(await R.action(args(post(cookie, { sex: "x", returnTo: "/pair" })))).toEqual({ errors: { sex: "Válaszd ki: férfi vagy nő." } });
    expect(await redirectOf(R.action(args(post(cookie, { sex: "male", returnTo: "/pair" }))))).toBe("/pair");
    expect(row("old")).toEqual({ sex: "male", done: 1 });
    // Asked once: from now on it goes straight through.
    expect((await requireUser(new Request("http://localhost/pair", { headers: { Cookie: cookie } }))).sex).toBe("male");
    expect(await redirectOf(R.loader(args(new Request("http://localhost/welcome?returnTo=%2Fpair", { headers: { Cookie: cookie } }))))).toBe("/pair");
  });

  it("Profil saves a change, and only Férfi or Nő", async () => {
    h.raw.prepare("insert into users (id, email, name, level, phone, sex, consent_at) values ('anna', 'anna@x.hu', 'Nagy Anna', 'halado', '+36301234567', 'female', 1)").run();
    const cookie = (await createSession("anna")).split(";")[0]!;
    const save = (sex: string) =>
      P.action(args(new Request("http://localhost/profile", { method: "POST", headers: { Cookie: cookie }, body: new URLSearchParams({ intent: "profile", name: "Nagy Anna", level: "halado", phone: "+36 30 123 4567", sex }) })));
    const refused: any = await save("other");
    expect(refused.data.errors).toEqual({ sex: "Válaszd ki: férfi vagy nő." });
    expect(row("anna").sex).toBe("female");
    expect(await save("male")).toMatchObject({ saved: true });
    expect(row("anna").sex).toBe("male");
  });
});

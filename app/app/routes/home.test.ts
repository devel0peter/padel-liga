// The landing page on a real SQLite (~/test/sqlite). The line after a player
// deleted their own account (#38): only for a visitor without a session, so
// a link with ?accountDeleted=1 can't tell a logged-in player their account
// is gone. Without the interest form (#332, D123): a post of the old form is
// refused and stores nothing. Email is stubbed and stays unused.
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
});

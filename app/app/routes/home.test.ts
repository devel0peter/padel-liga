// The home page's line after a player deleted their own account (#38) on a
// real SQLite (~/test/sqlite): only for a visitor without a session, so a
// link with ?accountDeleted=1 can't tell a logged-in player their account is
// gone.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

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

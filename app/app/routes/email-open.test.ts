// The tracking image route (#243, D161) on a real SQLite: a known token is
// counted, and every answer is the same uncacheable GIF.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, logs: [] as unknown[][] }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/log", () => ({ logWarn: (...args: unknown[]) => h.logs.push(args) }));

const { migratedDatabase } = await import("~/test/sqlite");
const { loader } = await import("./email-open");
const { TRANSPARENT_GIF } = await import("~/lib/email/opens");

const TOKEN = "0123456789abcdef0123456789abcdef";
const load = (token: string) => loader({ params: { token } } as any) as Promise<Response>;
const opened = () => h.raw.prepare("select opened_at is not null as opened, open_count as n from email_messages").get();

async function answer(r: Response) {
  return { status: r.status, headers: Object.fromEntries(r.headers), body: [...new Uint8Array(await r.arrayBuffer())] };
}

beforeEach(() => {
  h.raw = migratedDatabase();
  h.logs = [];
  h.raw
    .prepare("insert into email_messages (kind, to_email, subject, status, open_token) values ('groups_published', 'anna@x.hu', 's', 'sent', ?)")
    .run(TOKEN);
});

describe("GET /email/open/:token (#243)", () => {
  it("counts each load of a known token", async () => {
    await load(TOKEN);
    await load(TOKEN);
    expect(opened()).toEqual({ opened: 1, n: 2 });
  });

  it("answers an unknown or malformed token exactly like a known one, and counts nothing", async () => {
    const known = await answer(await load(TOKEN));
    expect(known.status).toBe(200);
    expect(known.headers["content-type"]).toBe("image/gif");
    expect(known.headers["cache-control"]).toContain("no-store");
    expect(known.body).toEqual([...TRANSPARENT_GIF]);
    for (const token of ["f".repeat(32), "1", "anna@x.hu"]) expect(await answer(await load(token))).toEqual(known);
    expect(opened()).toEqual({ opened: 1, n: 1 });
  });

  // The query's bound values (the token) never reach the log: lib/log.ts drops them from errors.
  it("still answers the image when the database fails, and logs a warning", async () => {
    h.raw.exec("drop table email_messages");
    expect((await answer(await load(TOKEN))).body).toEqual([...TRANSPARENT_GIF]);
    expect(h.logs.map((l) => l[0])).toEqual(["email open not recorded"]);
  });
});

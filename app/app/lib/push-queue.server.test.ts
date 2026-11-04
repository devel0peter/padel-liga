// The hourly job's push queue (#183, notifications.server.ts pushQueued) on a
// real SQLite: oldest first, an item only when all its devices fit the run,
// each push once, gone devices forgotten. Push is stubbed; nothing leaves the
// process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any, pushes: [] as string[], status: new Map<string, number>(), env: {} as Record<string, string> }));

vi.mock("cloudflare:workers", () => ({ env: h.env }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/push/webpush", async (original) => ({
  ...(await original<typeof import("~/lib/push/webpush")>()),
  pushRequest: async (s: { endpoint: string }, payload: string) => new Request(s.endpoint, { method: "POST", body: payload }),
}));

const { migratedDatabase } = await import("~/test/sqlite");
const N = await import("~/lib/notifications.server");
const { RunBudget } = await import("~/lib/run-usage");

const AT = new Date("2026-11-18T06:00:00Z");
const message = (n: number) => ({ title: `Hír ${n}`, body: "x", url: `/matches/${n}` });

beforeEach(() => {
  h.raw = migratedDatabase();
  h.env.VAPID_PUBLIC_KEY = "pub";
  h.env.VAPID_PRIVATE_KEY = "priv";
  h.pushes = [];
  h.status = new Map();
  for (const u of ["u1", "u2", "u3"])
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'halado', 1)").run(u, `${u}@x.hu`, u);
  // u1: three devices, u2: one, u3: none.
  const device = h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (?, ?, 'k', 'a')");
  for (const d of ["https://push.example/u1-a", "https://push.example/u1-b", "https://push.example/u1-c"]) device.run(d, "u1");
  device.run("https://push.example/u2", "u2");
  vi.stubGlobal("fetch", async (req: Request) => {
    h.pushes.push(`${req.url} ${JSON.parse(await req.text()).url}`);
    return new Response(null, { status: h.status.get(req.url) ?? 201 });
  });
});
afterEach(() => vi.unstubAllGlobals());

const queued = () => h.raw.prepare("select user_id as user, title from notifications where push_due_at is not null order by id").all();

// The queue as the hourly job fills it (notifyPlayers with queuePush).
async function queue(...users: string[]) {
  await N.notifyPlayers(
    "match_no_proposal",
    users.map((userId, i) => ({ userId, message: message(i + 1) })),
    AT,
    true,
  );
}

describe("pushQueued (#183)", () => {
  it("the job's items wait in the queue; nothing is pushed until the push step", async () => {
    await queue("u1", "u2", "u3");
    expect(h.pushes).toEqual([]);
    expect(queued()).toHaveLength(3);
  });

  it("with push switched off, the item is in the app but not queued", async () => {
    h.raw.prepare("insert into notification_opt_outs (user_id, kind) values ('u2', 'channel:push')").run();
    await queue("u1", "u2");
    expect(queued().map((n: any) => n.user)).toEqual(["u1"]);
    expect(h.raw.prepare("select count(*) as n from notifications").get().n).toBe(2);
  });

  it("pushes every queued item to every device, once; a second run has nothing left", async () => {
    await queue("u1", "u2", "u3");
    expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 3, left: 0 });
    expect(h.pushes.sort()).toEqual(
      [
        "https://push.example/u1-a /matches/1",
        "https://push.example/u1-b /matches/1",
        "https://push.example/u1-c /matches/1",
        "https://push.example/u2 /matches/2",
      ].map((p) => p.replace(/\/matches\/(\d)$/, (_, n) => `/notifications/${n}`)),
    );
    expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 0, left: 0 });
    expect(h.pushes).toHaveLength(4);
  });

  it("an item goes only when all its devices fit the run; the rest waits, oldest first", async () => {
    await queue("u2", "u1", "u2");
    // Keep all but two calls for later steps: u2's first item fits, u1's three devices don't.
    const budget = new RunBudget({ queries: 50, calls: 2 });
    expect(await N.pushQueued(budget, { queries: 0, calls: 0 })).toEqual({ pushed: 1, left: 2 });
    expect(queued().map((n: any) => n.title)).toEqual(["Hír 2", "Hír 3"]);
    expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 2, left: 0 });
    expect(h.pushes).toHaveLength(5);
  });

  it("keeps what the later steps need", async () => {
    await queue("u2");
    const budget = new RunBudget({ queries: 50, calls: 3 });
    expect(await N.pushQueued(budget, { queries: 0, calls: 3 })).toEqual({ pushed: 0, left: 1 });
    expect(h.pushes).toEqual([]);
  });

  it("forgets a device the push service no longer knows, in one query", async () => {
    h.status.set("https://push.example/u1-b", 410);
    h.status.set("https://push.example/u1-c", 404);
    await queue("u1");
    const budget = new RunBudget();
    expect(await N.pushQueued(budget)).toEqual({ pushed: 1, left: 0 });
    expect(h.raw.prepare("select endpoint from push_subscriptions order by endpoint").all().map((r: any) => r.endpoint)).toEqual([
      "https://push.example/u1-a",
      "https://push.example/u2",
    ]);
    // The queue, the devices, the claim, the forgetting, the queue again (empty), what's left.
    expect(budget.used()).toEqual({ queries: 6, calls: 3 });
  });

  it("without push keys the queue is emptied without pushing", async () => {
    delete h.env.VAPID_PUBLIC_KEY;
    await queue("u1", "u2");
    expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 2, left: 0 });
    expect(h.pushes).toEqual([]);
    expect(queued()).toEqual([]);
  });

  it("an item claimed by an overlapping run is not pushed again", async () => {
    await queue("u2");
    await Promise.all([N.pushQueued(new RunBudget()), N.pushQueued(new RunBudget())]);
    expect(h.pushes).toHaveLength(1);
  });
});

// The cron's push queue (#183, notifications.server.ts pushQueued) on a
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
const { beginInvocation } = await import("~/lib/log");

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

const devicesOf = (user: string) =>
  (h.raw.prepare("select endpoint from push_subscriptions where user_id = ? order by endpoint").all(user) as { endpoint: string }[]).map((r) => r.endpoint);
const queued = () => h.raw.prepare("select user_id as user, title from notifications where push_due_at is not null order by id").all();

// The queue as the cron or a request fills it (notifyPlayers, D158).
async function queue(...users: string[]) {
  await N.notifyPlayers(
    "match_no_proposal",
    users.map((userId, i) => ({ userId, message: message(i + 1) })),
    AT,
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

  it("a push service error is logged with how many pushes failed (#126)", async () => {
    h.status.set("https://push.example/u1-a", 500);
    h.status.set("https://push.example/u1-b", 503);
    const warnings: any[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: any) => void warnings.push(line));
    await queue("u1", "u2");
    expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 2, left: 0 });
    vi.restoreAllMocks();
    expect(warnings.filter((w) => w.event === "push")).toEqual([expect.objectContaining({ level: "warn", sent: 2, failed: 2, gone: 0 })]);
    expect(warnings.filter((w) => w.event === "push failed")).toHaveLength(2);
  });

  it("without push keys the queue is emptied without pushing", async () => {
    delete h.env.VAPID_PUBLIC_KEY;
    await queue("u1", "u2");
    expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 2, left: 0 });
    expect(h.pushes).toEqual([]);
    expect(queued()).toEqual([]);
  });

  it("a player with more devices than a run can push to doesn't hold up the queue: newest devices only, the others forgotten and logged (#222, #279)", async () => {
    // u1 gets 60 more devices, the newest last; with the three it has, more than a run's 50 calls.
    const device = h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth, created_at) values (?, 'u1', 'k', 'a', ?)");
    for (let i = 0; i < 60; i++) device.run(`https://push.example/u1-many-${i}`, 2_000_000_000 + i);
    await queue("u1", "u2");
    const warnings: any[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: any) => void warnings.push(line));
    try {
      // As the cron calls it: the email step's room kept (DELIVER_MIN).
      expect(await N.pushQueued(new RunBudget(), { queries: 5, calls: 3 })).toEqual({ pushed: 2, left: 0 });
    } finally {
      vi.restoreAllMocks();
    }
    expect(h.pushes.filter((p) => p.startsWith("https://push.example/u2 "))).toHaveLength(1);
    const u1 = h.pushes.filter((p) => p.startsWith("https://push.example/u1"));
    expect(u1.map((p) => p.split(" ")[0]).sort()).toEqual(
      Array.from({ length: N.MAX_PUSH_DEVICES }, (_, i) => `https://push.example/u1-many-${59 - i}`).sort(),
    );
    expect(warnings).toEqual([
      expect.objectContaining({ level: "warn", event: "push devices forgotten", notificationId: 1, devices: 63, kept: N.MAX_PUSH_DEVICES, forgotten: 53 }),
    ]);
    // Only the newest ten are left (D116).
    expect(devicesOf("u1")).toEqual(Array.from({ length: N.MAX_PUSH_DEVICES }, (_, i) => `https://push.example/u1-many-${59 - i}`).sort());
    expect(devicesOf("u2")).toEqual(["https://push.example/u2"]);
  });

  it("three items for one player over the cap: one warning in the run (#279)", async () => {
    const device = h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth, created_at) values (?, 'u1', 'k', 'a', ?)");
    for (let i = 0; i < 9; i++) device.run(`https://push.example/u1-more-${i}`, 2_000_000_000 + i);
    await queue("u1", "u1", "u2", "u1");
    const warnings: any[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: any) => void warnings.push(line));
    try {
      expect(await N.pushQueued(new RunBudget(), { queries: 5, calls: 3 })).toEqual({ pushed: 4, left: 0 });
    } finally {
      vi.restoreAllMocks();
    }
    expect(h.pushes.filter((p) => p.startsWith("https://push.example/u1"))).toHaveLength(3 * N.MAX_PUSH_DEVICES);
    expect(warnings).toEqual([expect.objectContaining({ event: "push devices forgotten", notificationId: 1, devices: 12, kept: N.MAX_PUSH_DEVICES, forgotten: 2 })]);
  });

  it("dead devices past the cap are forgotten with the others at the player's first push; nothing more is logged after (#279)", async () => {
    // u1: its three old devices (dead) are past the cap once ten newer ones exist.
    const device = h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth, created_at) values (?, 'u1', 'k', 'a', ?)");
    for (let i = 0; i < 10; i++) device.run(`https://push.example/u1-new-${i}`, 2_000_000_000 + i);
    for (const old of ["u1-a", "u1-b", "u1-c"]) h.status.set(`https://push.example/${old}`, 410);
    await queue("u1");
    const warnings: any[] = [];
    vi.spyOn(console, "warn").mockImplementation((line: any) => void warnings.push(line));
    const budget = new RunBudget();
    try {
      expect(await N.pushQueued(budget)).toEqual({ pushed: 1, left: 0 });
      // The dead ones were never pushed to, and are gone all the same.
      expect(h.pushes.some((p) => /u1-[abc] /.test(p))).toBe(false);
      expect(devicesOf("u1")).toEqual(Array.from({ length: 10 }, (_, i) => `https://push.example/u1-new-${i}`).sort());
      // No extra query: the queue, the devices, the claim, the forgetting, the queue again (empty), what's left.
      expect(budget.used()).toEqual({ queries: 6, calls: 10 });
      await queue("u1");
      expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 1, left: 0 });
    } finally {
      vi.restoreAllMocks();
    }
    expect(warnings).toEqual([expect.objectContaining({ event: "push devices forgotten", devices: 13, forgotten: 3 })]);
  });

  it("forgets at most 100 devices in one query; the rest go at the player's next push (#279)", async () => {
    const device = h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth, created_at) values (?, 'u1', 'k', 'a', ?)");
    for (let i = 0; i < 147; i++) device.run(`https://push.example/u1-many-${i}`, 2_000_000_000 + i);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await queue("u1");
      await N.pushQueued(new RunBudget());
      expect(devicesOf("u1")).toHaveLength(150 - 100);
      await queue("u1");
      await N.pushQueued(new RunBudget());
      expect(devicesOf("u1")).toHaveLength(N.MAX_PUSH_DEVICES);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("an item claimed by an overlapping run is not pushed again", async () => {
    await queue("u2");
    await Promise.all([N.pushQueued(new RunBudget()), N.pushQueued(new RunBudget())]);
    expect(h.pushes).toHaveLength(1);
  });
});

// #126, D158 (Peter, 2026-11-12): a request pushes its first items itself, up
// to INLINE_PUSH_CALLS push calls; the rest wait for the cron.
describe("pushes at once from a request, within its budget (#126)", () => {
  const inRequest = async (task: () => Promise<unknown>, kind: "request" | "cron" = "request") => {
    const end = beginInvocation(`test-${kind}`, kind);
    try {
      await task();
    } finally {
      end();
    }
  };
  const notify = (users: string[], kind: "match_proposal" | "groups_published" = "match_proposal") =>
    N.notifyPlayers(
      kind,
      users.map((userId, i) => ({ userId, message: message(i + 1) })),
    );
  // `n` more players with one device each: x0, x1, ...
  const players = (n: number) =>
    Array.from({ length: n }, (_, i) => {
      const id = `x${i}`;
      h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'halado', 1)").run(id, `${id}@x.hu`, id);
      h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (?, ?, 'k', 'a')").run(`https://push.example/${id}`, id);
      return id;
    });

  it("a small event (a proposal to the other pair) pushes at once; nothing waits", async () => {
    await inRequest(() => notify(["u1", "u2"]));
    expect(h.pushes.map((p) => p.split(" ")[0]).sort()).toEqual([
      "https://push.example/u1-a",
      "https://push.example/u1-b",
      "https://push.example/u1-c",
      "https://push.example/u2",
    ]);
    expect(queued()).toEqual([]);
    // The cron finds nothing to push again.
    expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 0, left: 0 });
    expect(h.pushes).toHaveLength(4);
  });

  it("an event over the budget pushes the budget at once and queues the rest; the cron sends those, each once", async () => {
    const ids = players(30);
    await inRequest(async () => {
      await notify(ids, "groups_published");
      // A second notice in the same request: the budget is spent.
      await notify(["u2"]);
    });
    expect(h.pushes).toHaveLength(N.INLINE_PUSH_CALLS);
    expect(queued().map((n: any) => n.user)).toEqual([...ids.slice(N.INLINE_PUSH_CALLS), "u2"]);
    expect(await N.pushQueued(new RunBudget())).toEqual({ pushed: 11, left: 0 });
    expect(h.pushes).toHaveLength(31);
    expect(new Set(h.pushes).size).toBe(31);
  });

  it("an item goes at once only when all its devices fit: the rest of the order waits", async () => {
    const ids = players(19);
    // 19 single devices, then u1's three: 22 calls, over the budget of 20.
    await inRequest(() => notify([...ids, "u1", "u2"]));
    expect(h.pushes).toHaveLength(19);
    expect(queued().map((n: any) => n.user)).toEqual(["u1", "u2"]);
  });

  it("a cron run pushes nothing at once: its pushes keep to the run's budget", async () => {
    await inRequest(() => notify(["u1", "u2"]), "cron");
    expect(h.pushes).toEqual([]);
    expect(queued()).toHaveLength(2);
  });

  it("with two invocations at once nothing is pushed at once (whose calls?); the cron sends it", async () => {
    const other = beginInvocation("other");
    try {
      await inRequest(() => notify(["u2"]));
    } finally {
      other();
    }
    expect(h.pushes).toEqual([]);
    expect(queued()).toHaveLength(1);
  });

  it("the topic switch applies at once too: a topic off, no push now or later", async () => {
    h.raw.prepare("insert into notification_opt_outs (user_id, kind) values ('u2', 'topic:scheduling')").run();
    await inRequest(() => notify(["u1", "u2"]));
    expect(h.pushes.map((p) => p.split(" ")[0])).not.toContain("https://push.example/u2");
    expect(h.pushes).toHaveLength(3);
    expect(queued()).toEqual([]);
    expect(h.raw.prepare("select count(*) as n from notifications where user_id = 'u2'").get().n).toBe(1);
  });
});

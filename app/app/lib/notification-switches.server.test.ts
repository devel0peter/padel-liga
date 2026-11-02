// The email and push switches of the profile (#115) on a real SQLite
// (~/test/sqlite), through the real outbox, notifications and season entry
// code. The email sender and the push services are stubbed: nothing leaves
// the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  raw: null as any,
  sent: [] as { to: string; subject: string }[],
  pushed: [] as string[],
}));

vi.mock("cloudflare:workers", () => ({
  env: { EMAIL_DAILY_LIMIT: "100", VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" },
}));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/cities.server", () => ({
  listCities: async () => [{ slug: "gyor", name: "Győr" }],
  listedCities: async () => [{ slug: "gyor" }],
}));
vi.mock("~/lib/email/send.server", () => ({
  MAX_BATCH: 100,
  relayConfigured: () => false,
  sendEmails: async (emails: any[]) => {
    h.sent.push(...emails);
    return emails.map((_, i) => ({ ok: true, id: `id-${i}` }));
  },
}));
// No encryption: the request goes straight to the device's endpoint.
vi.mock("~/lib/push/webpush", async (original) => ({
  ...(await original<typeof import("~/lib/push/webpush")>()),
  pushRequest: async (sub: { endpoint: string }) => new Request(sub.endpoint, { method: "POST" }),
}));
vi.stubGlobal("fetch", async (request: Request) => {
  h.pushed.push(request.url);
  return new Response(null, { status: 201 });
});

const { migratedDatabase } = await import("~/test/sqlite");
const E = await import("~/lib/season-entries.server");
const N = await import("~/lib/notifications.server");
const O = await import("~/lib/email/outbox.server");
const L = await import("~/lib/auth/login-code.server");
const SOLO = await import("~/lib/solo-pairing.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const DURING_REGISTRATION = new Date("2026-11-03T12:00:00Z");
const PHASES = ["2026-11-08T23:00:00Z", "2026-11-29T23:00:00Z", "2027-01-03T23:00:00Z", "2027-01-24T23:00:00Z"];

const all = (q: string) => h.raw.prepare(q).all();
const endpoint = (id: string) => `https://fcm.googleapis.com/fcm/send/${id}`;

beforeEach(() => {
  h.raw = migratedDatabase();
  h.sent = [];
  h.pushed = [];
  h.raw.exec(`insert into cities (slug, name, listed) values ('gyor', 'Győr', 1) on conflict do nothing`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  for (const [id, name] of [
    ["a", "Anna"],
    ["b", "Béla"],
    ["o", "Org"],
  ])
    h.raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'halado', 1)").run(id, `${id}@x.hu`, name);
  h.raw.exec(`insert into pairs (id, league_id, player_a, player_b) values (1, 1, 'a', 'b')`);
  h.raw
    .prepare(
      "insert into seasons (id, league_id, name, registration_opens_at, registration_closes_at, first_phase_start) values (1, 1, '2026/27 tél', ?, ?, '2026-11-09')",
    )
    .run(sec("2026-11-01T23:00:00Z"), sec("2026-11-05T22:59:00Z"));
  PHASES.forEach((start, i) =>
    h.raw
      .prepare("insert into season_phases (season_id, number, starts_at, deadline) values (1, ?, ?, ?)")
      .run(i + 1, sec(start), sec(start) + 21 * 86400 - 60),
  );
  // Both players allowed push on one device each.
  for (const id of ["a", "b"])
    h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (?, ?, 'k', 'k')").run(endpoint(id), id);
});

async function approve() {
  expect(await E.applyToSeason({ id: "a", email: "a@x.hu", name: "Anna", level: "halado" } as any, 1, DURING_REGISTRATION)).toMatchObject({
    ok: true,
  });
}

const inbox = (userId: string) =>
  all(`select kind, title, url from notifications where user_id = '${userId}' order by id`);

describe("notification switches (#115)", () => {
  it("a new player has email and push on", async () => {
    const disabled = await N.disabledKindsFor("a");
    expect(disabled.size).toBe(0);
    await approve();
    expect(h.sent.map((m) => m.to).sort()).toEqual(["a@x.hu", "b@x.hu"]);
    expect(h.pushed.sort()).toEqual([endpoint("a"), endpoint("b")]);
  });

  it("with email off, an entry sends no email but is on Értesítések", async () => {
    await N.setChannelEnabled("a", "email", false);
    await approve();
    expect(h.sent.map((m) => m.to)).toEqual(["b@x.hu"]);
    expect(all("select to_email from email_messages")).toEqual([{ to_email: "b@x.hu" }]);
    for (const id of ["a", "b"])
      expect(inbox(id)).toEqual([{ kind: "season_entry_decision", title: "Beneveztetek", url: "/pair" }]);
    // Push is a separate switch.
    expect(h.pushed.sort()).toEqual([endpoint("a"), endpoint("b")]);
  });

  it("with push off, no push is sent, but the email and the in-app notification are", async () => {
    await N.setChannelEnabled("a", "push", false);
    await approve();
    expect(h.pushed).toEqual([endpoint("b")]);
    expect(h.sent.map((m) => m.to).sort()).toEqual(["a@x.hu", "b@x.hu"]);
    expect(inbox("a")).toHaveLength(1);
    // The profile's "Próba" button doesn't push either.
    expect(await N.sendTestNotification("a")).toBe(0);
    expect(h.pushed).toEqual([endpoint("b")]);
  });

  it("switching back on restores both", async () => {
    await N.setChannelEnabled("a", "email", false);
    await N.setChannelEnabled("a", "push", false);
    await N.setChannelEnabled("a", "email", true);
    await N.setChannelEnabled("a", "push", true);
    expect((await N.disabledKindsFor("a")).size).toBe(0);
    await approve();
    expect(h.sent.map((m) => m.to).sort()).toEqual(["a@x.hu", "b@x.hu"]);
    expect(h.pushed.sort()).toEqual([endpoint("a"), endpoint("b")]);
  });

  it("with both off, the login code still arrives", async () => {
    await N.setChannelEnabled("a", "email", false);
    await N.setChannelEnabled("a", "push", false);
    expect(await L.sendLoginCode("a@x.hu")).toEqual({ ok: true, email: "a@x.hu" });
    expect(h.sent.map((m) => m.to)).toEqual(["a@x.hu"]);
    expect(all("select kind, status from email_messages")).toEqual([{ kind: "login_code", status: "sent" }]);
  });

  it("with email off, the groups email is skipped for that player only", async () => {
    await N.setChannelEnabled("a", "email", false);
    const input = {
      to: "x",
      partnerName: "y",
      league: "Padelpárbaj Győr",
      season: "2026/27 tél",
      phase: 1,
      group: 1,
      weeks: [],
      deadline: new Date("2026-11-29T22:59:00Z"),
    };
    // An address in another case is the same account.
    await O.queueGroupsPublished([
      { toEmail: "A@x.hu", input },
      { toEmail: "b@x.hu", input },
    ]);
    expect(h.sent.map((m) => m.to)).toEqual(["b@x.hu"]);
  });

  // Peter, 2026-10-29: only login codes and signup confirmations ignore the
  // switch; addresses without an account are unaffected.
  it("a pair intro skips the email of an account with email off, but is on its Értesítések", async () => {
    await N.setChannelEnabled("a", "email", false);
    const solo = (email: string) =>
      h.raw
        .prepare("insert into interest_signups (mode, name1, email1, city, level, consent_at) values ('solo', 'X', ?, 'gyor', 'kezdo', 1) returning id")
        .get(email).id as number;
    // Anna has an account (email off); z@x.hu has none.
    expect(await SOLO.pairSolos(solo("a@x.hu"), solo("z@x.hu"), "gyor", "Győr")).toBeNull();
    expect(all("select kind, to_email from email_messages")).toEqual([{ kind: "pair_intro", to_email: "z@x.hu" }]);
    expect(inbox("a")).toEqual([{ kind: "pair_intro", title: "Párt találtunk neked", url: "/pair" }]);
    expect(all("select count(*) n from notifications")[0].n).toBe(1);
    expect(h.pushed).toEqual([endpoint("a")]);
  });

  it("broadcasts and partner notices skip an account with email off; signup confirmations don't", async () => {
    await N.setChannelEnabled("a", "email", false);
    await O.createBroadcast({
      subject: "Hír",
      body: "Szia {név}!",
      audience: "Mind",
      recipients: [
        { email: "a@x.hu", name: "Anna" },
        { email: "z@x.hu", name: "Zoli" },
      ],
      createdBy: "o@x.hu",
    });
    expect(h.sent.map((m) => m.to)).toEqual(["z@x.hu"]);
    expect(await O.emailSwitchedOff()).toEqual(new Set(["a@x.hu"]));

    h.sent = [];
    // Anna signs up and names Béla as partner: her confirmation goes out.
    await O.deliver(
      await O.queueSignupEmails({ mode: "pair", name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu", city: "gyor", level: "halado" } as any),
    );
    // Béla's partner notice goes out too (email on); with email off it wouldn't.
    expect(h.sent.map((m) => m.to).sort()).toEqual(["a@x.hu", "b@x.hu"]);
    await N.setChannelEnabled("b", "email", false);
    h.raw.exec("delete from email_messages");
    h.sent = [];
    await O.deliver(
      await O.queueSignupEmails({ mode: "pair", name1: "Anna", email1: "a@x.hu", name2: "Béla", email2: "b@x.hu", city: "gyor", level: "halado" } as any),
    );
    expect(all("select kind, to_email from email_messages")).toEqual([{ kind: "signup_confirmation", to_email: "a@x.hu" }]);
  });

  it("a fan-out to many players takes a few D1 queries, not a few per player", async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `p${i}`);
    for (const id of ids) {
      h.raw.prepare("insert into users (id, email, name, consent_at) values (?, ?, ?, 1)").run(id, `${id}@x.hu`, id);
      h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (?, ?, 'k', 'k')").run(endpoint(id), id);
    }
    await N.setChannelEnabled("p0", "push", false);
    const raw = h.raw;
    const queries: string[] = [];
    h.raw = new Proxy(raw, {
      get(target, prop) {
        if (prop !== "prepare") {
          const value = Reflect.get(target, prop);
          return typeof value === "function" ? value.bind(target) : value;
        }
        return (q: string) => {
          queries.push(q);
          return target.prepare(q);
        };
      },
    });
    const message = { title: "Itt a csoportod: 1. csoport", body: "…", url: "/home" };
    await N.notifyPlayers("groups_published", ids.map((userId) => ({ userId, message })));
    h.raw = raw;

    // One opt-out lookup, 3 inserts of at most 15 rows, one subscription lookup.
    expect(queries.filter((q) => /^select .* from "notification_opt_outs"/.test(q))).toHaveLength(1);
    expect(queries.filter((q) => /^insert into "notifications"/.test(q))).toHaveLength(3);
    expect(queries.filter((q) => /from "push_subscriptions"/.test(q))).toHaveLength(1);
    expect(queries).toHaveLength(5);
    expect(all("select count(*) n from notifications")[0].n).toBe(40);
    // Each push carries its own notification's id.
    expect(h.pushed).toHaveLength(39);
    expect(new Set(h.pushed).size).toBe(39);
    expect(h.pushed).not.toContain(endpoint("p0"));
  });

  it("a Szervező's per-kind switch keeps working next to the push switch", async () => {
    h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o')`);
    h.raw.prepare("insert into push_subscriptions (endpoint, user_id, p256dh, auth) values (?, 'o', 'k', 'k')").run(endpoint("o"));
    const signup = { city: "gyor", cityOther: null, mode: "pair", level: "halado" } as any;

    await N.notifyNewSignup(signup);
    expect(inbox("o")).toEqual([expect.objectContaining({ kind: "new_signup" })]);
    expect(h.pushed).toEqual([endpoint("o")]);

    await N.setChannelEnabled("o", "push", false);
    await N.notifyNewSignup(signup);
    expect(inbox("o")).toHaveLength(2);
    expect(h.pushed).toEqual([endpoint("o")]);

    await N.setChannelEnabled("o", "push", true);
    await N.setKindEnabled("o", "new_signup", false);
    await N.notifyNewSignup(signup);
    expect(inbox("o")).toHaveLength(2);
    expect(h.pushed).toEqual([endpoint("o")]);
  });
});

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
  expect(await E.applyToSeason({ id: "a", email: "a@x.hu", name: "Anna", level: "halado" } as any, 1, DURING_REGISTRATION)).toEqual({
    ok: true,
  });
  const [entry] = all("select id from season_entries");
  expect(await E.decideEntry({ id: "o" }, 1, entry.id, "approve", null, DURING_REGISTRATION)).toEqual({ ok: true });
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

  it("with email off, an entry decision sends no email but is on Értesítések", async () => {
    await N.setChannelEnabled("a", "email", false);
    await approve();
    expect(h.sent.map((m) => m.to)).toEqual(["b@x.hu"]);
    expect(all("select to_email from email_messages")).toEqual([{ to_email: "b@x.hu" }]);
    for (const id of ["a", "b"])
      expect(inbox(id)).toEqual([{ kind: "season_entry_decision", title: "Jóváhagyták a nevezéseteket", url: "/pair" }]);
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

  it("the emails that aren't account notifications ignore the switch", async () => {
    await N.setChannelEnabled("a", "email", false);
    await O.queuePairIntros(
      { name: "Anna", email: "a@x.hu", level: "halado" },
      { name: "Béla", email: "b@x.hu", level: "halado" },
      "Győr",
    );
    expect(all("select kind, to_email from email_messages order by id")).toEqual([
      { kind: "pair_intro", to_email: "a@x.hu" },
      { kind: "pair_intro", to_email: "b@x.hu" },
    ]);
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

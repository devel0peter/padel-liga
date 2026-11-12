// Kezdőlap's tip (#262, D160) on a real SQLite (~/test/sqlite), with the
// real session lookup: the push tip is offered while the push channel is on;
// "Most nem" hides it for 14 days on every device (per account), the second
// time for good. Staff see it like players; their push doesn't count in the
// push statistics (D100). Nothing is sent.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("cloudflare:workers", () => ({ env: { VAPID_PUBLIC_KEY: "public", VAPID_PRIVATE_KEY: "private" } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));
vi.mock("~/lib/email/send.server", () => ({ MAX_BATCH: 100, relayConfigured: () => false, sendEmails: async () => [] }));

const { migratedDatabase } = await import("~/test/sqlite");
const { createSession } = await import("~/lib/auth/session.server");
const N = await import("~/lib/notifications.server");
const { currentPushStats } = await import("~/lib/push-stats.server");
const Home = await import("~/routes/app.home");

const DAY = 86_400;
const args = (cookie: string, init: RequestInit = {}) =>
  ({ request: new Request("http://localhost/home", { ...init, headers: { Cookie: cookie } }), params: {}, context: {} }) as any;
const tips = async (cookie: string) => ((await Home.loader(args(cookie))) as any).tips as string[];
const dismiss = (cookie: string, tip = "push") => Home.action(args(cookie, { method: "POST", body: new URLSearchParams({ intent: "dismiss_tip", tip }) }));
const dismissals = () => h.raw.prepare("select user_id as user, tip, count from tip_dismissals").all();
// Moves the stored dismissal back by `days`.
const age = (days: number) => h.raw.exec(`update tip_dismissals set dismissed_at = dismissed_at - ${days * DAY}`);

let anna = "";
beforeEach(async () => {
  h.raw = migratedDatabase();
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1)`);
  h.raw.exec(`insert into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr')`);
  h.raw.exec(`insert into users (id, email, name, level, phone, sex, consent_at) values
    ('a', 'a@x.hu', 'Anna', 'kezdo', '+36301234567', 'female', 1),
    ('o', 'o@x.hu', 'Org', 'kezdo', '+36301234568', 'male', 1)`);
  h.raw.exec(`insert into league_members (league_id, user_id, source) values (1, 'a', 'register'), (1, 'o', 'register')`);
  h.raw.exec(`insert into league_admins (league_id, user_id) values (1, 'o')`);
  anna = (await createSession("a")).split(";")[0]!;
});

describe("Kezdőlap tip (#262)", () => {
  it("offers the push tip, with the key the button subscribes with", async () => {
    const page: any = await Home.loader(args(anna));
    expect(page.tips).toEqual(["push"]);
    expect(page.vapidPublicKey).toBe("public");
  });

  it("not with the push channel off on the profile", async () => {
    await N.setChannelEnabled("a", "push", false);
    expect(await tips(anna)).toEqual([]);
  });

  it("Most nem: gone for 14 days on every device, back after; the second time for good", async () => {
    expect(await dismiss(anna)).toEqual({ season: 0, ok: true });
    expect(dismissals()).toEqual([{ user: "a", tip: "push", count: 1 }]);
    // Another device of hers: a new session, the same account.
    const phone = (await createSession("a")).split(";")[0]!;
    expect(await tips(phone)).toEqual([]);
    age(13);
    expect(await tips(anna)).toEqual([]);
    age(1);
    expect(await tips(anna)).toEqual(["push"]);
    await dismiss(phone);
    expect(dismissals()).toEqual([{ user: "a", tip: "push", count: 2 }]);
    age(400);
    expect(await tips(anna)).toEqual([]);
  });

  it("an unknown tip is refused and stores nothing", async () => {
    await expect(dismiss(anna, "nope")).rejects.toMatchObject({ status: 400 });
    expect(dismissals()).toEqual([]);
  });

  it("a Szervező sees it too; their device doesn't count in the push statistics", async () => {
    const org = (await createSession("o")).split(";")[0]!;
    expect(await tips(org)).toEqual(["push"]);
    // As the tip's button stores a subscription (via /api/push).
    await N.saveSubscription("o", { endpoint: "https://fcm.googleapis.com/fcm/send/o", p256dh: "k", auth: "k" });
    await N.saveSubscription("a", { endpoint: "https://fcm.googleapis.com/fcm/send/a", p256dh: "k", auth: "k" });
    expect(await currentPushStats()).toEqual({ players: 1, pushUsers: 1, devices: 1 });
  });
});

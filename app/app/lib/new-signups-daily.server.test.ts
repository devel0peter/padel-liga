import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  raw: null as { exec: (sql: string) => void; prepare: (sql: string) => { all: () => unknown[] } } | null,
  env: {} as Record<string, string>,
}));

vi.mock("cloudflare:workers", () => ({ env: h.env }));
vi.mock("cloudflare:sockets", () => ({ connect: () => { throw new Error("unused"); } }));
vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const D = await import("./new-signups-daily.server");

const sec = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const all = <T = Record<string, unknown>>(sql: string) => h.raw!.prepare(sql).all() as T[];

function freshDb() {
  h.raw = migratedDatabase();
  h.raw!.exec(`
    insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1);
    insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Győri liga');
    insert into users (id, email, name, platform_role, level, consent_at) values
      ('org1', 'org1@x.hu', 'Szervező Egy', 'player', 'halado', 1000),
      ('org2', 'org2@x.hu', 'Szervező Kettő', 'player', 'halado', 1000),
      ('org3', 'org3@x.hu', 'Szervező Három', 'player', 'halado', 1000),
      ('adm1', 'adm1@x.hu', 'Admin Egy', 'superadmin', 'halado', 1000),
      ('p1', 'p1@x.hu', 'Kovács Anna', 'player', 'kezdo', 1000);
    insert into league_admins (league_id, user_id) values (1, 'org1'), (1, 'org2'), (1, 'org3');
    insert into league_members (league_id, user_id, source) values (1, 'p1', 'chosen');
    insert into notification_opt_outs (user_id, kind) values
      ('org2', 'email:new_signups_daily'),
      ('org3', 'channel:email');
  `);
}

describe("queueNewSignupsDailyEmails (#383)", () => {
  beforeEach(freshDb);

  it("queues one morning email per eligible organizer only on days with events, never twice, with no personal data", async () => {
    const morning = new Date("2026-11-11T06:10:00Z"); // 07:10 Budapest (CET)
    // No events yesterday -> no emails
    expect(await D.queueNewSignupsDailyEmails(morning)).toBeNull();
    expect(all("select id from email_messages")).toHaveLength(0);

    // 3 sign-up events on 2026-11-10 Budapest
    h.raw!.exec(`
      insert into league_signup_events (league_id, kind, joins_phase, created_at) values
        (1, 'player_joined', null, ${sec("2026-11-10T10:00:00Z")}),
        (1, 'pair_formed', null, ${sec("2026-11-10T12:00:00Z")}),
        (1, 'pair_entered', 2, ${sec("2026-11-10T15:00:00Z")});
    `);

    // Before 07:00 Budapest -> nothing yet
    expect(await D.queueNewSignupsDailyEmails(new Date("2026-11-11T05:50:00Z"))).toBeNull();

    // At 07:10 Budapest -> queued for org1 and adm1 (org2 opted out of daily email, org3 opted out of email channel)
    expect(await D.queueNewSignupsDailyEmails(morning)).toBe("queued 2 daily sign-up summaries");
    const emails = all<{ to_email: string; subject: string; text: string; league_id: number; kind: string }>(
      "select to_email, subject, text, league_id, kind from email_messages order by to_email",
    );
    expect(emails.map((e) => e.to_email)).toEqual(["adm1@x.hu", "org1@x.hu"]);
    expect(emails[0].kind).toBe("new_signups_daily");
    expect(emails[0].league_id).toBe(1);
    expect(emails[0].text).toContain("1 új játékos, 1 új pár, 1 nevezés a 2. körre");
    expect(emails[0].text).toContain("/admin/leagues/gyor/players?tab=waiting");
    expect(emails[0].text).not.toContain("Kovács");
    expect(emails[0].text).not.toContain("p1@x.hu");

    // Second run same morning sends nothing
    expect(await D.queueNewSignupsDailyEmails(new Date("2026-11-11T07:10:00Z"))).toBeNull();
    expect(all("select id from email_messages")).toHaveLength(2);
  });
});

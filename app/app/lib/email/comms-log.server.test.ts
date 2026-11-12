// A person's email log and open tracking (#243, D161) on a real SQLite
// (~/test/sqlite). Nothing leaves the process.
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ raw: null as any }));

vi.mock("~/db/client.server", async () => (await import("~/test/sqlite")).mockClient(h));

const { migratedDatabase } = await import("~/test/sqlite");
const { personCommsLog, recordOpen } = await import("./comms-log.server");

const ANNA = "0123456789abcdef0123456789abcdef";
const BELA = "fedcba9876543210fedcba9876543210";

function mail(id: number, kind: string, to: string, token: string | null, status = "sent") {
  h.raw
    .prepare(
      `insert into email_messages (id, kind, to_email, subject, status, provider_id, sent_at, open_token, created_at)
       values (?, ?, ?, 'Tárgy', ?, ?, ?, ?, ?)`,
    )
    .run(id, kind, to, status, status === "sent" ? "dev-1" : null, status === "sent" ? 1_794_500_000 : null, token, 1_794_500_000 - id);
}

const opens = () => h.raw.prepare("select id, opened_at, open_count from email_messages order by id").all();

beforeEach(() => {
  h.raw = migratedDatabase();
  mail(1, "groups_published", "anna@x.hu", ANNA);
  mail(2, "match_proposal", "bela@x.hu", BELA);
  mail(3, "login_code", "anna@x.hu", null);
});

describe("recordOpen (#243)", () => {
  it("marks only the email with that token: the first open's time stays, the count grows", async () => {
    expect(await recordOpen(ANNA, new Date("2026-11-12T17:05:00Z"))).toBe(true);
    expect(await recordOpen(ANNA, new Date("2026-11-12T19:00:00Z"))).toBe(true);
    expect(opens()).toEqual([
      { id: 1, opened_at: Date.parse("2026-11-12T17:05:00Z") / 1000, open_count: 2 },
      { id: 2, opened_at: null, open_count: 0 },
      { id: 3, opened_at: null, open_count: 0 },
    ]);
  });

  it("an unknown or malformed token changes nothing", async () => {
    for (const token of ["0".repeat(32), "1", "anna@x.hu", `${ANNA}x`, ANNA.toUpperCase(), "' or 1=1 --"]) expect(await recordOpen(token)).toBe(false);
    expect(opens().every((r: any) => r.opened_at === null && r.open_count === 0)).toBe(true);
  });

  it("a malformed token never reaches the database", async () => {
    h.raw.exec("drop table email_messages");
    for (const token of ["' or 1=1 --", "1", "anna@x.hu", `${ANNA}0`, ANNA.toUpperCase()]) expect(await recordOpen(token)).toBe(false);
    // A well-shaped one does query (and fails here, the table is gone).
    await expect(recordOpen(BELA)).rejects.toThrow();
  });

  it("an email deleted with its account takes its open data with it", async () => {
    await recordOpen(ANNA);
    h.raw.prepare("delete from email_messages where lower(to_email) = 'anna@x.hu'").run();
    expect(opens().map((r: any) => r.id)).toEqual([2]);
    expect(await recordOpen(ANNA)).toBe(false);
  });

  it("stores nothing about the reader: the table has no column for it", () => {
    const columns = h.raw.prepare("select name from pragma_table_info('email_messages')").all().map((c: any) => c.name);
    expect(columns.filter((c: string) => c.startsWith("open"))).toEqual(["open_token", "opened_at", "open_count"]);
    expect(columns.some((c: string) => /ip|agent|device/i.test(c))).toBe(false);
  });
});

describe("personCommsLog: open status (#243)", () => {
  it("shows the open status of tracked sent emails only, never the token", async () => {
    mail(4, "season_start", "anna@x.hu", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "pending");
    await recordOpen(ANNA, new Date("2026-11-12T17:05:00Z"));
    const log = await personCommsLog("Anna@X.hu");
    // Newest first: the seeded rows are made in reverse id order.
    expect(log.rows.map((r) => [r.id, r.opened])).toEqual([
      [1, "Megnyitva: 2026. 11. 12. 18:05 · 1 megnyitás"],
      [3, null],
      [4, null],
    ]);
    expect(JSON.stringify(log)).not.toContain(ANNA);
    expect(JSON.stringify(log)).not.toContain("aaaaaaaa");
  });

  it("a tracked email nobody opened: nobody knows", async () => {
    const log = await personCommsLog("bela@x.hu");
    expect(log.rows.map((r) => r.opened)).toEqual(["Nem ismert, hogy megnyitotta"]);
  });
});

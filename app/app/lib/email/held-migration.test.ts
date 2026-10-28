// The deploy step of the held outbox (#88, D24): migration 0022 holds mail
// that was queued but not sent yet, except login codes and signup
// confirmations. Runs every migration before it on a real SQLite, adds rows,
// then applies 0022.
import { describe, expect, it } from "vitest";

const { readdirSync, readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);
const { DatabaseSync } = await import(/* @vite-ignore */ `node:${"sqlite"}`);

const MIGRATIONS = new URL("../../../drizzle/", import.meta.url);
const HELD = "0022_held_emails.sql";

function apply(raw: any, file: string) {
  for (const stmt of readFileSync(new URL(file, MIGRATIONS), "utf8").split("--> statement-breakpoint"))
    if (stmt.trim()) raw.exec(stmt);
}

describe("migration 0022_held_emails", () => {
  it("holds unsent mail that isn't a login code or a signup confirmation, and nothing else", () => {
    const raw = new DatabaseSync(":memory:");
    const files = (readdirSync(MIGRATIONS) as string[]).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain(HELD);
    for (const f of files.filter((f) => f < HELD)) apply(raw, f);

    const rows: [string, string][] = [
      ["login_code", "pending"],
      ["signup_confirmation", "pending"],
      ["signup_confirmation", "sending"],
      ["pair_invite", "pending"],
      ["broadcast", "sending"],
      ["pair_answer", "sent"],
      ["partner_notice", "failed"],
    ];
    const st = raw.prepare("insert into email_messages (kind, to_email, subject, status, claimed_at) values (?, 'x@x.hu', 's', ?, 1)");
    for (const [kind, status] of rows) st.run(kind, status);

    apply(raw, HELD);
    expect(raw.prepare("select kind, status, claimed_at from email_messages order by id").all()).toEqual([
      { kind: "login_code", status: "pending", claimed_at: 1 },
      { kind: "signup_confirmation", status: "pending", claimed_at: 1 },
      { kind: "signup_confirmation", status: "sending", claimed_at: 1 },
      { kind: "pair_invite", status: "held", claimed_at: null },
      { kind: "broadcast", status: "held", claimed_at: null },
      { kind: "pair_answer", status: "sent", claimed_at: 1 },
      { kind: "partner_notice", status: "failed", claimed_at: 1 },
    ]);
  });
});

// #112: the held outbox is gone. Migration 0024 sends what is still held,
// except mail to an address that unsubscribed, bounced or complained meanwhile.
describe("migration 0024_release_held_emails", () => {
  const RELEASE = "0024_release_held_emails.sql";

  it("turns held mail into pending, and deletes held mail to a suppressed address", () => {
    const raw = new DatabaseSync(":memory:");
    const files = (readdirSync(MIGRATIONS) as string[]).filter((f) => f.endsWith(".sql")).sort();
    expect(files).toContain(RELEASE);
    for (const f of files.filter((f) => f < RELEASE)) apply(raw, f);

    const rows: [string, string, string][] = [
      ["registration_invite", "anna@x.hu", "held"],
      ["broadcast", "Bela@x.hu", "held"],
      ["groups_published", "cili@x.hu", "held"],
      ["pair_intro", "dani@x.hu", "held"],
      ["broadcast", "bela@x.hu", "sent"],
      ["login_code", "bela@x.hu", "pending"],
      ["partner_notice", "ede@x.hu", "failed"],
    ];
    const st = raw.prepare("insert into email_messages (kind, to_email, subject, status, claimed_at) values (?, ?, 's', ?, 1)");
    for (const [kind, to, status] of rows) st.run(kind, to, status);
    const sup = raw.prepare("insert into email_suppressions (email, reason) values (?, ?)");
    sup.run("bela@x.hu", "unsubscribed");
    sup.run("cili@x.hu", "bounced");

    apply(raw, RELEASE);
    expect(raw.prepare("select kind, to_email, status, claimed_at from email_messages order by id").all()).toEqual([
      { kind: "registration_invite", to_email: "anna@x.hu", status: "pending", claimed_at: null },
      { kind: "pair_intro", to_email: "dani@x.hu", status: "pending", claimed_at: null },
      { kind: "broadcast", to_email: "bela@x.hu", status: "sent", claimed_at: 1 },
      { kind: "login_code", to_email: "bela@x.hu", status: "pending", claimed_at: 1 },
      { kind: "partner_notice", to_email: "ede@x.hu", status: "failed", claimed_at: 1 },
    ]);
  });
});

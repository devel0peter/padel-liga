// The deploy step of the held outbox (#88, D24): migration 0021 holds mail
// that was queued but not sent yet, except login codes and signup
// confirmations. Runs every migration before it on a real SQLite, adds rows,
// then applies 0021.
import { describe, expect, it } from "vitest";

const { readdirSync, readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);
const { DatabaseSync } = await import(/* @vite-ignore */ `node:${"sqlite"}`);

const MIGRATIONS = new URL("../../../drizzle/", import.meta.url);
const HELD = "0021_held_emails.sql";

function apply(raw: any, file: string) {
  for (const stmt of readFileSync(new URL(file, MIGRATIONS), "utf8").split("--> statement-breakpoint"))
    if (stmt.trim()) raw.exec(stmt);
}

describe("migration 0021_held_emails", () => {
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

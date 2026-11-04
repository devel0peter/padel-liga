// Adds an account_invites row for an email. Optional since #113: anyone can
// create an account; the row only exempts the address from the daily cap on
// login codes to new addresses (auth/rules.ts).
//   npm run auth:invite -w app -- anna@example.com [--remote] [--note "Szervező"]
// Without --remote it writes the local dev database.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const noteAt = args.indexOf("--note");
const note = noteAt >= 0 ? args[noteAt + 1] : null;
const email = args.find((a, i) => !a.startsWith("--") && (noteAt < 0 || i !== noteAt + 1))?.trim().toLowerCase();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run auth:invite -w app -- <email> [--remote] [--note <text>]");
  process.exit(1);
}

const q = (s) => (s == null ? "NULL" : `'${String(s).replaceAll("'", "''")}'`);
// With its audit entry (#225, D91): no account yet, so no id to name, and no
// email in the log; actor_id null: the command line ("Rendszer").
const sql =
  `INSERT INTO account_invites (email, note) VALUES (${q(email)}, ${q(note)}) ON CONFLICT(email) DO UPDATE SET note = excluded.note; ` +
  `INSERT INTO audit_log (actor_id, action, target, detail) VALUES (NULL, 'account_invite.create', 'account_invite', 'cli');`;

execFileSync("npx", ["wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", "--command", sql], {
  stdio: "inherit",
});
console.log(`Invited ${email}${remote ? " (remote)" : " (local)"}.`);

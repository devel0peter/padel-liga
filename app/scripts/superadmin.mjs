// Makes an existing account Főadmin (superadmin), or takes it back. The only
// way to change this role: no page or request can (docs/admin-plan.md).
//   npm run auth:superadmin -w app -- <email> [--remote] [--revoke]
// The person must have logged in once, so the account exists.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const remote = args.includes("--remote");
const revoke = args.includes("--revoke");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();

if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run auth:superadmin -w app -- <email> [--remote] [--revoke]");
  process.exit(1);
}

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const d1 = (sql, json = false) =>
  execFileSync("npx", ["wrangler", "d1", "execute", "DB", remote ? "--remote" : "--local", "--command", sql, ...(json ? ["--json"] : [])], {
    encoding: "utf8",
    stdio: json ? ["ignore", "pipe", "inherit"] : "inherit",
  });

const found = JSON.parse(d1(`SELECT id, platform_role FROM users WHERE email = ${q(email)};`, true))[0]?.results ?? [];
if (found.length === 0) {
  console.error(`No account for ${email}. Log in with it once (it may need: npm run auth:invite), then run this again.`);
  process.exit(1);
}

const role = revoke ? "player" : "superadmin";
const action = revoke ? "superadmin.revoke" : "superadmin.grant";
d1(
  `UPDATE users SET platform_role = '${role}' WHERE email = ${q(email)}; ` +
    `INSERT INTO audit_log (actor_id, action, target, detail) VALUES (NULL, '${action}', ${q(email)}, 'cli');`,
);
console.log(`${email} is now ${revoke ? "a player (Főadmin removed)" : "Főadmin"}${remote ? " (remote)" : " (local)"}.`);

// Runs one read-only query against the database and prints the rows as JSON.
//   npm run db:read -w app -- "SELECT count(*) AS n FROM interest_signups" [--local]
// Remote (production) by default. Refuses anything that isn't a single SELECT,
// WITH ... SELECT, EXPLAIN or a PRAGMA read, so a permission rule for this
// script can't be used to write.
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const local = args.includes("--local");
const sql = args.filter((a) => a !== "--local").join(" ").trim().replace(/;\s*$/, "");

const fail = (msg) => {
  console.error(`${msg}\nUsage: npm run db:read -w app -- "<SELECT ...>" [--local]`);
  process.exit(1);
};

if (!sql) fail("No query.");
if (sql.includes(";")) fail("One statement only.");
if (/--|\/\*/.test(sql)) fail("No comments.");
if (!/^(select|with|explain|pragma)\b/i.test(sql)) fail("Only SELECT, WITH, EXPLAIN or PRAGMA.");
if (/\b(insert|update|delete|replace|upsert|drop|alter|create|attach|detach|vacuum|reindex)\b/i.test(sql)) {
  fail("Write keyword found.");
}
if (/^pragma\b/i.test(sql) && sql.includes("=")) fail("PRAGMA writes are not allowed.");

const out = execFileSync(
  "npx",
  ["wrangler", "d1", "execute", "DB", local ? "--local" : "--remote", "--json", "--command", sql],
  { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
);
const [result] = JSON.parse(out);
console.log(JSON.stringify(result.results, null, 2));

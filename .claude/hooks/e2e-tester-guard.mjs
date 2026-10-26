// What the e2e-tester agent (.claude/agents/e2e-tester.md, #103) may do. The
// agent's `tools` list cannot limit Bash to certain commands, so a PreToolUse
// hook (e2e-tester-hook.mjs, which calls this) does:
//   - Bash runs only when it is exactly one of the commands below, with only
//     the options listed. No shell operator, redirect or expansion.
//   - Write only creates app/e2e/.reports/<name>.md (the report body for gh).
//   - Read, Grep and Glob stay inside the repo and never touch secret files.
// Nothing here allows a remote D1, a deploy, `git commit`/`push`, `gh pr merge`,
// `gh pr checkout`, a Playwright option that loads code (--config, --reporter)
// or deletes a folder (--output).
//
// Pure (no I/O), tested by app/e2e/00-e2e-tester.spec.ts.
import { posix } from "node:path";

const Q = String.raw`"[^"$\x60\\\n]*"`; // double-quoted, nothing a shell would interpret
const PR = String.raw`[1-9][0-9]{0,5}`;
const REPORT_FILE = String.raw`app/e2e/\.reports/[\w.-]+\.md`;
const PATH_TOKEN = String.raw`(?:/[\p{L}\p{N}._:/=@,+-]*|"/[^"$\x60\\\n\s]*")`;
// The only options `npm run e2e:shots` takes (app/e2e/shots-args.ts).
const SHOTS_OPTION = String.raw`(?:--data (?:seed|walked)|--as (?:anon|player|organizer|admin)|--click ${Q}|--label [\w-]{1,40}|${PATH_TOKEN})`;

const ALLOWED = [
  // The suite: all of it, one spec by name, or the list. No other Playwright option.
  /^npm run e2e(?: -- (?:--list|(?:--grep|-g) [\p{L}\p{N}_.-]{1,60}))?$/u,
  new RegExp(String.raw`^npm run e2e:shots -- ${SHOTS_OPTION}(?: ${SHOTS_OPTION})*$`, "u"),
  // Reading a PR, and commenting on it (the body comes from a file in .reports).
  new RegExp(String.raw`^gh pr diff ${PR}(?: --name-only)?$`),
  new RegExp(String.raw`^gh pr view ${PR}(?: --json [a-zA-Z,]+)?$`),
  new RegExp(String.raw`^gh pr comment ${PR} --body-file ${REPORT_FILE}$`),
  // A defect that needs its own issue.
  new RegExp(String.raw`^gh issue create --title "[^"$\x60\\\n]{1,120}" --body-file ${REPORT_FILE}$`, "u"),
  // Read-only git, to see what is checked out.
  /^git (?:status|status --short|log --oneline -[0-9]{1,2}|diff --name-only origin\/develop\.\.\.HEAD|diff origin\/develop\.\.\.HEAD|rev-parse --abbrev-ref HEAD|fetch origin)$/,
];

// Shell operators and expansions are never needed: one plain command per call.
const SHELL_SYNTAX = /[;&|<>`\n\r\\$]/;
// Belt and braces: the suite refuses these itself, and the lists above never allow them.
const REMOTE_FLAG = /(?:^|[\s"'=])--(?:remote|preview|production|env|repo|hostname)\b/;

// Files that hold secrets or logins: never read, never quoted in a report.
const SECRET_PATH = /(?:^|\/)(?:\.dev\.vars[^/]*|\.env[^/]*|[^/]*\.kdbx|[^/]*keepass[^/]*|secrets\.json|\.wrangler|\.state\/auth|\.git\/config|node_modules)(?:\/|$)/i;
const SECRET_GLOB = /\.dev\.vars|\.env|kdbx|keepass|secrets\.json|\.wrangler|\.state\/auth/i;

const under = (path, roots) => roots.some((r) => path === r || path.startsWith(`${r.replace(/\/$/, "")}/`));

// `roots`: the repo directories the agent may work in (CLAUDE_PROJECT_DIR and
// the agent's own cwd). Anything else, or no roots at all, is refused.
export function checkToolCall(toolName, toolInput, cwd, roots) {
  const base = typeof cwd === "string" && cwd.startsWith("/") ? cwd : "/";
  const okRoots = (Array.isArray(roots) ? roots : [cwd]).filter((r) => typeof r === "string" && r.startsWith("/") && r !== "/").map((r) => posix.normalize(r));
  const deny = (reason) => ({ allow: false, reason });

  if (toolName === "Bash") {
    const command = typeof toolInput?.command === "string" ? toolInput.command.trim() : "";
    if (!command) return deny("Bash: empty command.");
    // The quoted parts are checked by the lists below; look for syntax in the rest.
    if (SHELL_SYNTAX.test(command.replace(/"[^"$`\\\n]*"/g, '""')) || /[`$\\]/.test(command))
      return deny("Bash: one plain command only, no operators, redirects or expansions.");
    if (REMOTE_FLAG.test(command)) return deny("Bash: no --remote, --preview, --production, --env, --repo or --hostname.");
    if (!ALLOWED.some((re) => re.test(command))) return deny(`Bash: "${command.slice(0, 80)}" is not on the e2e-tester's list (.claude/hooks/e2e-tester-guard.mjs).`);
    return { allow: true };
  }

  if (toolName === "Write") {
    const file = typeof toolInput?.file_path === "string" ? toolInput.file_path : "";
    const resolved = posix.resolve(base, file);
    const ok = okRoots.some((r) => new RegExp(`^${r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/app/e2e/\\.reports/[\\w.-]+\\.md$`).test(resolved));
    return ok ? { allow: true } : deny("Write: only <repo>/app/e2e/.reports/<name>.md (the report body for gh) may be written.");
  }

  if (toolName === "Read" || toolName === "Grep" || toolName === "Glob") {
    const target = typeof toolInput?.file_path === "string" ? toolInput.file_path : typeof toolInput?.path === "string" ? toolInput.path : ".";
    const resolved = posix.resolve(base, target);
    if (!under(resolved, okRoots)) return deny(`${toolName}: only files inside the repo.`);
    if (SECRET_PATH.test(resolved)) return deny(`${toolName}: that file may hold secrets or logins.`);
    for (const k of ["glob", "pattern"]) {
      const v = toolInput?.[k];
      if (toolName !== "Grep" && k === "pattern" && typeof v === "string" && SECRET_GLOB.test(v)) return deny("Glob: not for secret files.");
      if (k === "glob" && typeof v === "string" && SECRET_GLOB.test(v)) return deny("Grep: not for secret files.");
    }
    return { allow: true };
  }

  return deny(`${toolName}: not a tool the e2e-tester may use.`);
}

#!/usr/bin/env node
// PreToolUse hook of the e2e-tester agent (.claude/agents/e2e-tester.md, #103).
// The agent's `tools` list cannot limit Bash to certain commands, so this does:
// a Bash command runs only when it is exactly one of the commands below, and a
// file is written only into app/e2e/.reports/. Everything else is blocked
// (exit 2, the reason on stderr goes back to the agent). Nothing here allows
// a remote D1, a deploy, `git commit`/`push`, `gh pr merge` or a shell
// operator, so the agent cannot do them whatever its prompt says.
//
// Pure function `checkToolCall` (tested by app/e2e/00-e2e-tester.spec.ts);
// the stdin/exit part at the bottom runs only when the file is the entry point.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { posix } from "node:path";

// One argument: letters (Hungarian too), digits and a few path characters, or a
// double-quoted string without the characters a shell would interpret.
const ARG = String.raw`(?:[\p{L}\p{N}._:/=@,?+-]+|"[^"$\x60\\\n]*")`;
const PR = String.raw`[1-9][0-9]{0,5}`;
const REPORT_FILE = String.raw`app/e2e/\.reports/[\w.-]+\.md`;

const ALLOWED = [
  // The suite, and the screenshot tool (their own guards refuse remote and production).
  new RegExp(String.raw`^npm run e2e(?: -- (?:${ARG})(?: ${ARG})*)?$`, "u"),
  new RegExp(String.raw`^npm run e2e:shots -- (?:${ARG})(?: ${ARG})*$`, "u"),
  // Reading a PR, and commenting on it (the body comes from a file in .reports).
  new RegExp(String.raw`^gh pr diff ${PR}(?: --name-only)?$`),
  new RegExp(String.raw`^gh pr view ${PR}(?: --json [a-zA-Z,]+)?$`),
  new RegExp(String.raw`^gh pr checkout ${PR}$`),
  new RegExp(String.raw`^gh pr comment ${PR} --body-file ${REPORT_FILE}$`),
  // A defect that needs its own issue.
  new RegExp(String.raw`^gh issue create --title "[^"$\x60\\\n]{1,120}" --body-file ${REPORT_FILE}$`, "u"),
  // Read-only git, to see what is checked out.
  /^git (?:status|status --short|log --oneline -[0-9]{1,2}|diff --name-only origin\/develop\.\.\.HEAD|diff origin\/develop\.\.\.HEAD|rev-parse --abbrev-ref HEAD|fetch origin)$/,
];

// Shell operators and expansions are never needed: one plain command per call.
const SHELL_SYNTAX = /[;&|<>`\n\r\\]|\$\(|\$\{/;

export function checkToolCall(toolName, toolInput, cwd = "/") {
  if (toolName === "Bash") {
    const command = typeof toolInput?.command === "string" ? toolInput.command.trim() : "";
    // The quoted parts may hold `$`-free text only (see ARG), so test the rest for syntax.
    const outsideQuotes = command.replace(/"[^"\n]*"/g, '""');
    if (!command || SHELL_SYNTAX.test(outsideQuotes) || /[`$\\]/.test(command)) return { allow: false, reason: "Bash: one plain command only, no operators, redirects or expansions." };
    // The suite refuses these itself; refuse them here too, before it starts.
    if (/(?:^|\s)--(?:remote|preview|production|env|repo)\b/.test(command)) return { allow: false, reason: "Bash: no --remote, --preview, --production, --env or --repo." };
    if (!ALLOWED.some((re) => re.test(command)))
      return { allow: false, reason: `Bash: "${command.slice(0, 80)}" is not on the e2e-tester's list (.claude/hooks/e2e-tester-guard.mjs).` };
    return { allow: true };
  }
  if (toolName === "Write") {
    const file = typeof toolInput?.file_path === "string" ? toolInput.file_path : "";
    const resolved = posix.resolve(cwd, file);
    if (!/^(?:.*\/)?app\/e2e\/\.reports\/[\w.-]+\.md$/.test(resolved) || resolved.includes("/.reports/../"))
      return { allow: false, reason: "Write: only app/e2e/.reports/<name>.md (the report body for gh) may be written." };
    return { allow: true };
  }
  return { allow: false, reason: `${toolName}: not a tool the e2e-tester may use.` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let input;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    console.error("e2e-tester guard: unreadable hook input, blocked.");
    process.exit(2);
  }
  const result = checkToolCall(input.tool_name, input.tool_input, input.cwd);
  if (!result.allow) {
    console.error(`Blocked: ${result.reason}`);
    process.exit(2);
  }
}

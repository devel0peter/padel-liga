// The e2e-tester agent's own parts (#103): the screenshot tool's command line
// and the hook that limits what the agent may run. No browser needed.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { checkToolCall } from "../../.claude/hooks/e2e-tester-guard.mjs";
import { APP_DIR } from "./env";
import { checkPath, parseShotsArgs, shotName } from "./shots-args";

const REPO = join(APP_DIR, "..");
const bash = (command: string) => checkToolCall("Bash", { command }, REPO).allow;
const write = (file_path: string) => checkToolCall("Write", { file_path }, REPO).allow;

test.describe("e2e:shots arguments", () => {
  test("defaults to the seed, as the admin", () => {
    expect(parseShotsArgs(["/admin/leagues"])).toEqual({ data: "seed", roles: ["admin"], click: null, label: "shots", paths: ["/admin/leagues"] });
  });

  test("reads roles, data, click and label", () => {
    const a = parseShotsArgs(["--data", "walked", "--as", "player", "--as", "anon", "--as", "player", "--click", "Létrehozás", "--label", "pr-99", "/pair", "/home"]);
    expect(a).toEqual({ data: "walked", roles: ["player", "anon"], click: "Létrehozás", label: "pr-99", paths: ["/pair", "/home"] });
  });

  test("refuses what it cannot take", () => {
    expect(() => parseShotsArgs([])).toThrow(/path/);
    expect(() => parseShotsArgs(["--as", "root", "/x"])).toThrow(/--as is one of/);
    expect(() => parseShotsArgs(["--data", "prod", "/x"])).toThrow(/--data is one of/);
    expect(() => parseShotsArgs(["--bogus", "/x"])).toThrow(/Unknown option/);
    expect(() => parseShotsArgs(["--as"])).toThrow(/needs a value/);
    expect(() => parseShotsArgs(["--label", "../x", "/x"])).toThrow(/--label/);
    // The seed has no player accounts.
    expect(() => parseShotsArgs(["--as", "player", "/pair"])).toThrow(/--data walked/);
    expect(() => parseShotsArgs(["--as", "player", "--data", "walked", "/pair"])).not.toThrow();
  });

  test("only local paths: no other host, ever", () => {
    for (const bad of ["https://padelparbaj.hu/", "//padelparbaj.hu", "padelparbaj.hu", "/a b", "http://localhost:5199/", "/x://y", "\\\\evil"])
      expect(() => checkPath(bad), bad).toThrow(/Not a local path/);
    expect(checkPath("/admin/leagues/minta/seasons?x=1")).toBe("/admin/leagues/minta/seasons?x=1");
  });

  test("names screenshots by role, page and width", () => {
    expect(shotName("admin", "/admin/leagues/minta/seasons", "mobile")).toBe("admin-admin-leagues-minta-seasons-mobile.png");
    expect(shotName("anon", "/", "desktop")).toBe("anon-home-desktop.png");
    expect(shotName("player", "/pair?x=1", "mobile-after-click")).toBe("player-pair-x-1-mobile-after-click.png");
  });
});

test.describe("the e2e-tester's Bash and Write guard", () => {
  test("allows the suite, the screenshot tool, reading a PR and commenting", () => {
    for (const ok of [
      "npm run e2e",
      "npm run e2e -- --grep groups",
      "npm run e2e:shots -- --data walked --as admin --label pr-99 /admin/leagues",
      'npm run e2e:shots -- --as admin --click "Létrehozás" /admin/leagues/minta/seasons',
      "gh pr diff 99",
      "gh pr diff 99 --name-only",
      "gh pr view 99 --json files,title",
      "gh pr comment 99 --body-file app/e2e/.reports/report-99.md",
      'gh issue create --title "A lap 500-at ad" --body-file app/e2e/.reports/issue-seasons.md',
      "git status --short",
      "git log --oneline -5",
      "git diff --name-only origin/develop...HEAD",
      "git rev-parse --abbrev-ref HEAD",
    ])
      expect(bash(ok), ok).toBe(true);
  });

  test("blocks remote D1, deploys, email, commits, merges and pushes", () => {
    for (const bad of [
      "npm run deploy",
      "npm run deploy -w app",
      "npm run db:migrate:remote -w app",
      'npm run db:read -w app -- "select 1"',
      "npm run auth:invite -w app -- a@b.hu --remote",
      "npm run e2e -- --remote",
      "npx wrangler d1 execute DB --remote --command 'select 1'",
      "npx wrangler deploy",
      "gh pr merge 99 --merge",
      "gh pr comment 99 --body-file ../../etc/passwd",
      "gh pr comment 99 --body-file app/e2e/.reports/x.txt",
      "gh pr comment 99 --body hello",
      "gh pr comment 99 --repo other/repo --body-file app/e2e/.reports/r.md",
      "gh pr close 99",
      "gh pr review 99 --approve",
      "gh issue close 103",
      "gh api repos/devel0peter/padel-liga/pulls/99/merge -X PUT",
      "git commit -am x",
      "git push",
      "git push origin HEAD",
      "git checkout main",
      "git reset --hard",
      "curl https://padelparbaj.hu",
      "rm -rf app",
      "node -e 1",
      "cat app/.dev.vars",
      "",
    ])
      expect(bash(bad), bad).toBe(false);
  });

  test("blocks shell operators and expansions on an allowed command", () => {
    for (const bad of [
      "npm run e2e && git push",
      "npm run e2e; git push",
      "npm run e2e | tee x",
      "npm run e2e > /etc/x",
      "npm run e2e $(git push)",
      "npm run e2e `git push`",
      "npm run e2e\ngit push",
      'npm run e2e:shots -- --click "$(git push)" /x',
      'npm run e2e:shots -- --click "`git push`" /x',
      "npm run e2e:shots -- /x & git push",
      "gh pr diff 99 || git push",
      "gh pr comment 99 --body-file app/e2e/.reports/r.md; git push",
      'gh issue create --title "x" --body-file app/e2e/.reports/r.md --repo a/b',
    ])
      expect(bash(bad), JSON.stringify(bad)).toBe(false);
  });


  test("blocks the Playwright and script options that load code or delete folders", () => {
    for (const bad of [
      "npm run e2e -- --config=e2e/.reports/x.md",
      "npm run e2e -- -c e2e/.reports/x.md",
      "npm run e2e -- --reporter=./x.js",
      "npm run e2e -- --output=.",
      "npm run e2e -- --output=..",
      "npm run e2e -- --global-setup=x.js",
      "npm run e2e -- --ui",
      'npm run e2e -- "--remote"',
      'npm run e2e -- "--env=production"',
      "npm run e2e -- --grep a b",
      "npm run e2e:shots -- --config=x /x",
      "npm run e2e:shots -- --as root /x",
      "npm run e2e:shots -- --data prod /x",
      "npm run e2e:shots -- --label ../x /x",
      "npm run e2e:shots -- https://padelparbaj.hu/",
      "npm run e2e:shots -- --click Nev /x",
      "gh pr checkout 99",
    ])
      expect(bash(bad), bad).toBe(false);
    // What it does take.
    for (const ok of ["npm run e2e -- --list", "npm run e2e -- -g groups", 'npm run e2e:shots -- --as admin --as anon --data walked --click "Pár létrehozása" --label x-1 /pair "/admin/x?a=1"'])
      expect(bash(ok), ok).toBe(true);
  });

  test("writes only report files in app/e2e/.reports of the repo", () => {
    expect(write("app/e2e/.reports/report-99.md")).toBe(true);
    expect(write(join(REPO, "app/e2e/.reports/report-99.md"))).toBe(true);
    for (const bad of [
      "app/app/routes/home.tsx",
      "app/e2e/.reports/x.ts",
      "app/e2e/.reports/../shots.md",
      "app/e2e/.reports/sub/x.md",
      "../x.md",
      ".claude/hooks/e2e-tester-guard.mjs",
      "README.md",
      // The right ending under another directory.
      "/tmp/app/e2e/.reports/x.md",
      `${REPO}-other/app/e2e/.reports/x.md`,
      "/home/someone/.claude/app/e2e/.reports/x.md",
    ])
      expect(write(bad), bad).toBe(false);
  });

  test("reads stay in the repo and never open secrets", () => {
    const read = (file_path: string) => checkToolCall("Read", { file_path }, REPO).allow;
    expect(read("app/e2e/.reports/shots/x/a.png")).toBe(true);
    expect(read(join(REPO, "app/app/routes.ts"))).toBe(true);
    for (const bad of [
      "app/.dev.vars",
      "app/.dev.vars.e2e",
      ".env",
      "app/.env.local",
      "app/e2e/.state/auth/admin@example.test.json",
      "/etc/passwd",
      "../outside.txt",
      "/home/mracs/.config/psionic-flare/keepass.env",
      "/home/mracs/Databases/x.kdbx",
      "node_modules/x/index.js",
    ])
      expect(read(bad), bad).toBe(false);
    expect(checkToolCall("Grep", { pattern: "x", path: "app/app" }, REPO).allow).toBe(true);
    expect(checkToolCall("Grep", { pattern: "x", path: "/etc" }, REPO).allow).toBe(false);
    expect(checkToolCall("Grep", { pattern: "KEY", glob: "**/.dev.vars*" }, REPO).allow).toBe(false);
    expect(checkToolCall("Glob", { pattern: "**/.env*" }, REPO).allow).toBe(false);
    expect(checkToolCall("Glob", { pattern: "app/app/routes/*.tsx" }, REPO).allow).toBe(true);
  });

  test("no other tool is allowed", () => {
    for (const tool of ["Edit", "NotebookEdit", "WebFetch", "Agent"]) expect(checkToolCall(tool, {}, REPO).allow, tool).toBe(false);
  });

  const HOOK = join(REPO, ".claude/hooks/e2e-tester-hook.mjs");
  const call = (tool_name: string, tool_input: object, cwd: unknown = REPO) => JSON.stringify({ tool_name, tool_input, cwd });

  test("as a hook: exit 2 when blocked, 0 when allowed", () => {
    const run = (stdin: string) => spawnSync("node", [HOOK], { input: stdin, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: REPO } });
    expect(run(call("Bash", { command: "npm run e2e" })).status).toBe(0);
    const blocked = run(call("Bash", { command: "git push" }));
    expect(blocked.status).toBe(2);
    expect(blocked.stderr).toMatch(/Blocked/);
    expect(run(call("Write", { file_path: "app/e2e/.reports/r.md" })).status).toBe(0);
    expect(run(call("Read", { file_path: "app/.dev.vars" })).status).toBe(2);
  });

  test("the hook fails closed: garbage, a throwing input, a missing file, a symlinked path", () => {
    const run = (stdin: string, file = HOOK) => spawnSync("node", [file], { input: stdin, encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: REPO } });
    expect(run("not json").status).toBe(2);
    expect(run("").status).toBe(2);
    expect(run(call("Bash", { command: "git push" }, null)).status).toBe(2);
    expect(run(call("Bash", { command: "git push" }, 42)).status).toBe(2);
    // Through a symlink the guard still runs (an entry-point check would skip it).
    const dir = mkdtempSync(join(tmpdir(), "e2e-hook-"));
    try {
      symlinkSync(join(REPO, ".claude/hooks"), join(dir, "hooks"));
      expect(run(call("Bash", { command: "git push" }), join(dir, "hooks/e2e-tester-hook.mjs")).status).toBe(2);
      expect(run(call("Bash", { command: "npm run e2e" }), join(dir, "hooks/e2e-tester-hook.mjs")).status).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // The frontmatter command, with the hook file missing: blocked, not allowed.
    const command = /command: "(.*)"$/m.exec(frontMatter())?.[1].replace(/\\"/g, '"') ?? "";
    expect(command).toContain("|| exit 2");
    const missing = spawnSync("sh", ["-c", command], { input: call("Bash", { command: "git push" }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: "/nonexistent" } });
    expect(missing.status).toBe(2);
    const present = spawnSync("sh", ["-c", command], { input: call("Bash", { command: "npm run e2e" }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: REPO } });
    expect(present.status).toBe(0);
  });

  const frontMatter = () => /^---\n([\s\S]*?)\n---/.exec(readFileSync(join(REPO, ".claude/agents/e2e-tester.md"), "utf8"))?.[1] ?? "";

  test("the agent file wires the hook to every tool it has, with no wider tools", () => {
    const front = frontMatter();
    expect(front).toMatch(/^name: e2e-tester$/m);
    expect(front).toMatch(/^model: sonnet$/m);
    const tools = /^tools: (.*)$/m.exec(front)?.[1].split(/,\s*/) ?? [];
    expect(tools).toEqual(["Read", "Grep", "Glob", "Bash", "Write"]);
    // Every tool it has goes through the hook.
    const matcher = /matcher: "([^"]+)"/.exec(front)?.[1].split("|") ?? [];
    expect(matcher.sort()).toEqual([...tools].sort());
    expect(front).toContain("e2e-tester-hook.mjs");
    const md = readFileSync(join(REPO, ".claude/agents/e2e-tester.md"), "utf8");
    for (const never of ["Send email", "remote D1", "Commit, push, merge"]) expect(md).toContain(never);
  });
});

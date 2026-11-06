# End-to-end tests

`npm run e2e` from the repo root walks through milestone 1 ([the walkthrough](walkthrough.md)) in headless Chromium, in about 2 minutes. Once per machine, after `npm ci`: `npx playwright install chromium` (on a fresh Linux box also `npx playwright install-deps chromium`).

- It owns its environment: a fresh local D1 in `app/e2e/.state/` (never your `app/.wrangler/state`), migrations and the #90 seed, a dev server with `app/.dev.vars.e2e` (written by the suite: no Resend key, no Turnstile), so your `app/.dev.vars` and a dev server on 5173 are left alone.
- Its port is `E2E_PORT` when set, else a free one picked at start (D98), so several worktrees can run the suite at the same time, each against its own server and D1. The server, the readiness check and the browser use `127.0.0.1` only, never `localhost` (which can also mean `::1`, where another server could listen on the same port; #284). A busy port stops the run within seconds with a message naming the port, before any test runs or the state is wiped; the suite never runs against a server it didn't start.
- Logins read the code from the dev server's own output (`app/e2e/.state/server.log`), where every email is printed.
- It refuses `--remote`/`--env`/`--production`, a set `RESEND_API_KEY`, `SMTP_USER` or `SMTP_PASSWORD`, `NODE_ENV=production`, another Cloudflare config and a base URL other than its own.
- Report: `app/e2e/playwright-report/index.html`, with a trace and screenshots for each failed test (`app/e2e/test-results/`).
- CI: the `e2e` job in `.github/workflows/ci.yml` runs it on every pull request, next to `check` (see D42). A red run has a `playwright-report` artifact with the report, traces, screenshots and the server log.

## The e2e-tester agent

`.claude/agents/e2e-tester.md` (Sonnet) looks at the pages a branch or PR changed, before a UI PR merges (#103). Call it from Claude Code with a PR number or the checked-out branch: "use the e2e-tester on #123". It:

1. reads the diff and lists the new or changed pages and who may open them;
2. runs `npm run e2e` and reports the result;
3. runs `npm run e2e:shots` on the changed paths: each page as `anon`, `player`, `organizer` and `admin` (the refused states), on the empty seed and on the state the suite leaves behind, with a desktop (1280px) and a 390px screenshot of each, the HTTP status, redirects, script errors and sideways scroll;
4. writes `app/e2e/.reports/report-<pr>.md` (verdict, suite counts, a row per page and state, steps to reproduce each failure) and posts it as a PR comment. When it can't post, it returns the report to the caller. A defect that isn't this PR's can become an issue.

GitHub's CLI can't attach images, so the comment names the screenshot files in `app/e2e/.reports/shots/<label>/` (gitignored) and the caller drags the ones that matter into the PR.

- **Setup:** the same as the suite (`npm ci`, `npx playwright install chromium`). No MCP server and no `.mcp.json`: `npm run e2e:shots` drives the suite's own Playwright, so it can only reach the suite's own local server (the same port rule as the suite, D98).
- **By hand:** `npm run e2e:shots -- [--data seed|walked] [--as admin|organizer|player|anon]... [--click "Button name"] [--label name] <path>...`. `--data seed` is a fresh seeded D1; `walked` is the state of the last `npm run e2e` (needed for `--as player`). Exit code 1 when a page answers 5xx or throws.
- **What it can't do:** the agent file has a hook (`.claude/hooks/e2e-tester-hook.mjs`, rules in `e2e-tester-guard.mjs`) on all its tools. Bash allows only `npm run e2e` (whole, `--list` or `--grep <name>`), `npm run e2e:shots` with its own options, `gh pr diff/view/comment`, `gh issue create` and a few read-only `git` commands, one plain command per call. `Write` only creates `app/e2e/.reports/<name>.md`; Read, Grep and Glob stay in the repo and refuse `.dev.vars`, `.env`, KeePass and saved logins. No email, remote D1, deploy, commit, push or merge. The hook fails closed (an error or a missing hook file blocks), and its unit tests are in `app/e2e/00-e2e-tester.spec.ts`. The screenshot tool aborts every request to a host other than the suite's own `localhost:<port>`.
- **Trust:** `npm run e2e` runs the checked-out branch's own specs, config and scripts, which the hook can't see into. Run the agent on branches of this repo, not on a stranger's fork.
- **Order:** `--data walked` needs the state `npm run e2e` left; a `--data seed` run replaces it (and `walked` then refuses until the suite runs again), so look at the filled state first.

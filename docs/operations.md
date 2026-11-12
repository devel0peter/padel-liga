# Operations

How the live system is set up and how to restore it. The reasons behind each choice are in [decisions.md](decisions.md).

## Hosting and domain

- `padelparbaj.hu` is a Cloudflare zone (Free plan). The Worker serves the apex; `www` is a proxied record with a Single Redirect rule (301 to the apex, keeping path and query). Always Use HTTPS is on. The Worker is not served from `workers.dev` (`workers_dev: false`), but Cron Triggers need the Cloudflare account to have a `workers.dev` subdomain.
- Database: Cloudflare D1 `padel-liga-eu` (EU jurisdiction); its id is in `app/wrangler.jsonc`. Migrations in `app/drizzle/` must be additive and safe on live data.
- Deploys: every push to `main` (a release: a merge of `develop` into `main`) runs `.github/workflows/ci.yml`: typecheck, tests, build, remote D1 migrations, deploy. `npm run deploy` is a manual fallback for when CI is down.
- Scheduled jobs (deadlines, reminders, digests, auto-accept, backup) are Cloudflare Cron Triggers.
- Logs: `npm run logs:read -w app -- ...` (see `CLAUDE.md`). Health check: `GET /health`, opened every minute by the watchdog (see Monitoring).

## Monitoring

Everything runs inside Cloudflare (D170): no outside uptime service.

### The watchdog

`padel-liga-watchdog` (`watchdog/`, D169) is a second Worker that opens `https://padelparbaj.hu/health` once a minute, the way a visitor does: domain, DNS, the zone's security rules, the app's Worker and the database are all on its path. It succeeds only on status 200 with the body `ok` within 10 seconds; anything else (another status, a redirect, another body, a Cloudflare challenge, no answer in time, a network error) is a failure. Each run writes one `watchdog check` line: info on success, error with a `reason` on failure (fields `url`, `ok`, `status`, `ms`, `reason`; nothing personal). It sends `User-Agent: padelparbaj-watchdog/1 (...)`, so its requests are easy to find in the zone's security events.

**Why a separate Worker:** a broken app deploy, an exception in the app or a removed route can't stop it. It has no bindings (no D1, no R2, no secrets) and no address of its own (`workers_dev` and preview URLs off, no route); it only runs on its Cron Trigger. Cloudflare's own active probe (Health Checks) is Pro-only.

**Deploy:** CI deploys it right after the app on every push to `main` (a release); a failed watchdog deploy fails the run. It needs no secret. Its typecheck and tests run in the `check` job with the rest (`npm run typecheck`, `npm test`).

**Cost:** about 1,440 runs a day, inside Workers Free (100,000 requests a day; the run waits on the network, not the CPU). It uses 1 of the account's 5 Cron Triggers (the app uses 2). Its `GET /health` is not counted on the traffic page (`/health` has no page, D92); the app still writes its `request` line.

**Try it locally:** `npm run dev -w watchdog` (it opens the real address), then `curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*+*+*+*+*"`; the line shows in the terminal. To see a failure, point it at a local server: `npm run dev -w watchdog -- --var HEALTH_URL:http://localhost:8788/health`.

**Logs:** in the Cloudflare dashboard, Workers & Pages, `padel-liga-watchdog`, Logs. (`npm run logs:read` reads the app's Worker only.)

### Workers Issues

Workers Issues (Cloudflare's error grouping, open beta, free) is on for the app's Worker through `observability.issues.enabled` in `app/wrangler.jsonc`. **It must stay there:** a deploy without it switches Issues off, even when it was switched on in the dashboard. The "új hiba" alert below fires on each new error group.

### Alerts

All alerts are Cloudflare notification policies that email the Cloudflare account's address. They are managed through the API (Notifications), not by hand, with the KeePass entry `PadelParbaj/Cloudflare API token` (read through the `core:secrets` script, never printed). The log alerts are Custom Alerts on the Workers logs (`logs.workersLogs`, SQL, `source: sql_api`).

| Alert | Condition | Checked |
|---|---|---|
| Padelpárbaj: leállt (őr) | the watchdog wrote at least 2 failed checks in 3 minutes, or nothing at all for 3 minutes (the watchdog itself stopped). Created after the release, see below | every minute |
| Padelpárbaj: leállt (nincs cron-futás) | 0 scheduled runs of the app in 30 minutes. Deleted once "leállt (őr)" has run a day without a false alarm | every 5 minutes |
| Padelpárbaj: 5xx válaszok | at least 2 responses with status 500 or higher in 5 minutes | every minute |
| Padelpárbaj: sok hiba | at least 80 error lines of the app in 15 minutes; lower to 10 after #314 | every 5 minutes |
| Padelpárbaj: új hiba (Workers Issues) | every new error group of the app's Worker | on event |
| Padelpárbaj: Cloudflare-incidens (Workers, D1, DNS, CDN) | a major or critical Cloudflare Status incident on Workers, D1, Workers Assets, CDN/Cache or Authoritative DNS | on event |
| Default budget alert (auto-created) | Cloudflare spending reaches 10 USD | on event |

The app's alerts filter on `scriptName = 'padel-liga'`, so the watchdog's error lines don't count toward "sok hiba".

**Blind spot (D170):** an outage of Cloudflare's own network or of the whole Workers platform can stop the watchdog and the alerting with it, and a broken DNS setup can't be seen from inside. The "Cloudflare-incidens" alert covers that as far as Cloudflare reports it.

### After the release (orchestrator)

The release that first deploys the watchdog (#318) needs these changes through the API. They are not in code, so they are listed here; the agent applies them after Peter's release.

1. **Zone rule, so zone security never challenges the watchdog.** In the zone `padelparbaj.hu`, phase `http_request_firewall_custom` (WAF custom rules; the Free plan allows 5, one is used by the scanner-path block), add as the **first** rule:
   - description: `Watchdog: GET /health skips security (#318)`
   - expression: `(http.request.method eq "GET" and http.request.uri.path eq "/health" and starts_with(http.user_agent, "padelparbaj-watchdog/"))`
   - action: `skip`, `action_parameters`: `{"ruleset": "current", "phases": ["http_ratelimit", "http_request_firewall_managed"], "products": ["bic", "securityLevel", "uaBlock", "zoneLockdown", "hot"]}`, logging on.

   It skips the other custom rules, rate limiting, managed rules, Browser Integrity Check and the security level for this one request only; every other path and method keeps its protection. The User-Agent can be copied, but the rule only opens `GET /health`, which answers `ok` or `unavailable` and nothing else (the rate-limit rule only covers POSTs anyway). Once the security events show the watchdog's requests, `cf.worker.upstream_zone` can tighten it if it holds a value for them. **Bot Fight Mode can't be skipped by any rule** (Free plan). If the security events show it challenging the watchdog (`watchdog check` failures with "challenged by Cloudflare"), ask Peter whether to switch Bot Fight Mode off.
2. **Check for a day:** the watchdog's logs show one success line a minute, and the zone's security events (filter User-Agent `padelparbaj-watchdog`) show no challenge or block.
3. **Create "Padelpárbaj: leállt (őr)":** `alert_type: custom_analytics`, `execution_interval: 1m`, `alert_trigger_preferences_short_window: 3m`, threshold `>= 2`, `alert_interval` as the others, the same email mechanism, description `Az őr 3 percen belül legalább kétszer nem érte el a /health címet, vagy 3 perce nem fut. #318`. One selector covers both cases (no line at all reads as 2):
   ```sql
   SELECT CASE WHEN count() = 0 THEN 2 ELSE countIf(level = 'error') END AS value FROM logs.workersLogs WHERE accountTag = '<account id>' AND scriptName = 'padel-liga-watchdog' AND timestamp >= NOW() - INTERVAL '3' MINUTE
   ```
   If the SQL API refuses that form, make two policies with the same email: "Padelpárbaj: leállt (őr)" (`count()` with `level = 'error'`, `>= 2`) and "Padelpárbaj: leállt (őr néma)" (`count()` with `logType = 'cf-worker-event' AND invocationType = 'scheduled'`, `== 0`).
4. **Test it once:** set the threshold so it fires (for example `>= 0`), confirm Peter got the email, set it back.
5. **Delete "Padelpárbaj: leállt (nincs cron-futás)"** once "leállt (őr)" ran a day without a false alarm.
6. **Workers Issues:** the dashboard's Issues page shows `padel-liga` enabled after the release; the first error group sends the "új hiba" email.

## Email

- Mail is sent from `hello@padelparbaj.hu` through the Google Workspace SMTP relay, with Resend (EU region) as the fallback (D114, D45, D46). All mail goes through the outbox in `app/app/lib/email/outbox.server.ts`.
- DNS for mail lives in the Cloudflare zone: the Google Workspace verification TXT, MX, SPF and DKIM; for Resend the `resend._domainkey` TXT and the `send` and `rsend` CNAMEs (added by Resend's Cloudflare auto-configure).
- DMARC: one record, `p=none` with a `rua` address; reports go to Cloudflare DMARC Management. Tighten to `quarantine` once the mail passes.
- A request never sends mail itself: it stores it, and it goes out right after the response, the rest with the 10-minute cron, at most 10 per claim (D150). An email whose send was cut short is marked failed ("interrupted while sending") and never resent by itself. Check the Google Admin email log search (sender `hello@padelparbaj.hu`, subject) for what really left, then use "Újraküldés" on Kimenő levelek (`/admin/outbox`) for that kind.
- Secrets: `RESEND_API_KEY` and `EMAIL_SECRET` (local: `app/.dev.vars`; without a key, dev logs emails to the console).
- Resend webhook: `https://padelparbaj.hu/webhooks/resend`, secret `RESEND_WEBHOOK_SECRET`, events `email.bounced`, `email.complained` and, for the player profile's email log (D157, #242), `email.delivered`. Without `email.delivered` a Resend email stays "Elküldve" in the log; bounces and complaints still mark it. Each event logs "email delivery" with the state and whether a stored email matched (no address).

## Backups

D1 Time Travel keeps 30 days and restores in place (`npx wrangler d1 time-travel restore padel-liga-eu --timestamp=<unix>`, see the Cloudflare docs). On top of that the Worker exports the whole database to R2 every day (D69, `app/app/lib/backup.server.ts`, called from the `scheduled` handler in `app/workers/app.ts`).

Setup: the deploy fails while the bucket in `app/wrangler.jsonc` does not exist. R2 must be enabled on the Cloudflare account first (Cloudflare asks for a payment method even for the free tier, which this export stays far inside). Then create the bucket:

```
npx wrangler r2 bucket create padel-liga-backups --jurisdiction eu
```

Keep it private (the default): no public bucket URL, no custom domain. Nothing else to set: the binding is `BACKUPS` in `app/wrangler.jsonc`, and no secret is needed.

**Is it working?** In the Cloudflare dashboard, R2, `padel-liga-backups`, folder `daily/`: one file per day, the newest 35. The Worker's logs (`app/app/lib/log.ts`, D92) have `backup step` lines while it works (three to six runs after 03:00 UTC for a small database; fields `pieces`, `table`, `calls`) and one `backup finished` line when the file is written (`file`, `bytes`, `pieces`, `maxPieces`, `ceilingPercent`, `deletedFiles`); a failed run leaves a `backup failed` error line (`npm run logs:read -w app -- --event "backup failed"`), and `backup unfinished day dropped` means an earlier day never got its file. To run it by hand locally: `npm run build -w app`, then `npx wrangler dev -c build/server/wrangler.json --test-scheduled` (in `app/`) and open `/cdn-cgi/handler/scheduled?cron=*/5+3-5+*+*+*` until the logs say the file is written (each open is one step).

**Size ceiling (#282).** The last run glues the pieces into the file with one R2 call per piece, inside the run's 40 calls (`LIMITS.maxOps`, under the Workers Free 50), so one file can have at most **33 pieces** (`maxParts` in `backup.server.ts`). A piece is at most about 400,000 characters of SQL (`stepChars`, plus one page of rows), so the ceiling is **about 13 MB of SQL** (the database was well under 1 MB in November 2026). An export that needs more pieces can't be glued: every run then fails with `backup failed` ("… pieces are too many to glue …") and no new daily file is written. Every `backup finished` line says how close it got (`pieces` of `maxPieces`, `ceilingPercent`), and past 75% (25 pieces or more) a **`backup near size ceiling`** warning follows (`npm run logs:read -w app -- --event "backup near size ceiling"`). **When it appears:** Time Travel still covers the last 30 days, and each finished file is good, so there is time, but act within weeks: look for tables that grow without need (old notifications, `job_runs`, `email_messages`) and prune them, or raise the ceiling in code (glue in two rounds, or larger pieces if the CPU per run allows). Raising it is a code change with its own ticket.

### Restoring a backup

The file is plain SQL (UTF-8). It holds personal data (emails, phone numbers, sessions): download it only to a machine you control and delete it afterwards.

1. Download a file (from the dashboard, or): `npx wrangler r2 object get padel-liga-backups/daily/padel-liga-2026-11-02.sql --remote --jurisdiction eu --file restore.sql`
2. Into a local database, from `app/`. A restore needs an empty database, so use a new state folder (or delete `app/.wrangler/state/v3/d1` to replace your local dev database):
   ```
   npx wrangler d1 execute DB --local --persist-to ../restored --file ../restore.sql
   npx wrangler d1 execute DB --local --persist-to ../restored --command "SELECT count(*) FROM users"
   ```
   `npx wrangler d1 migrations apply DB --local --persist-to ../restored` then says "No migrations to apply" (the file carries `d1_migrations`). To run the app on it, use the same `--persist-to` folder, or copy the folder over `app/.wrangler/state`.
3. Or into a plain SQLite file: `sqlite3 restored.db < restore.sql`. D1 runs the file in one transaction and checks foreign keys at its end; `sqlite3` does not check them at all.
4. Production: never run the file over the live database (it would fail on the existing tables, and a partial run is worse). Create a new D1 database (`npx wrangler d1 create padel-liga-restored --jurisdiction eu`), run the file on it with `--remote`, check it, then point `d1_databases` in `app/wrangler.jsonc` at it in a normal release. For the last 30 days Time Travel is quicker.

**What a restore drops.** The steps are minutes apart, not one transaction, so the file can hold rows that never existed together. The end of the file cleans them up so the restore can't fail on them: a row whose parent row isn't in the file gets what the live database would have done had the parent gone: where the link is one the database empties (`ON DELETE SET NULL`: who wrote an audit-log entry, who dissolved a pair, who decided a match, who wrote a match log line, and similar) the row stays with that link emptied (#282); any other such row is deleted (a login after `users` was read, before `sessions`). Of two rows with the same unique value (a primary key or a unique index) only the one read last stays (#179). A dropped row's dependants are settled the same way, with or without foreign keys (D1, or a plain `sqlite3` restore): a pair read as active just before it was dissolved goes, and so do its entries and matches; an account read just before its email address went to a new account goes with its sessions and pairs, while the audit entries it wrote and the pairs it dissolved stay without it. Files written before #282 delete those rows instead and still restore. Only rows written in the few minutes of the export around 04:00 Budapest time can be hit. To get such a row back: Time Travel to a moment outside the export (`npx wrangler d1 time-travel info padel-liga-eu --timestamp=<unix>`), or the day before's file, and copy the row over by hand.

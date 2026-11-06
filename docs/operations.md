# Operations

How the live system is set up and how to restore it. The reasons behind each choice are in [decisions.md](decisions.md).

## Hosting and domain

- `padelparbaj.hu` is a Cloudflare zone (Free plan). The Worker serves the apex; `www` is a proxied record with a Single Redirect rule (301 to the apex, keeping path and query). Always Use HTTPS is on. The Worker is not served from `workers.dev` (`workers_dev: false`), but Cron Triggers need the Cloudflare account to have a `workers.dev` subdomain.
- Database: Cloudflare D1 `padel-liga-eu` (EU jurisdiction); its id is in `app/wrangler.jsonc`. Migrations in `app/drizzle/` must be additive and safe on live data.
- Deploys: every push to `main` (a release: a merge of `develop` into `main`) runs `.github/workflows/ci.yml`: typecheck, tests, build, remote D1 migrations, deploy. `npm run deploy` is a manual fallback for when CI is down.
- Scheduled jobs (deadlines, reminders, digests, auto-accept, backup) are Cloudflare Cron Triggers.
- Logs: `npm run logs:read -w app -- ...` (see `CLAUDE.md`). Health check: `GET /health`.

## Email

- Mail is sent from `hello@padelparbaj.hu` through the Google Workspace SMTP relay, with Resend (EU region) as the fallback (D114, D45, D46). All mail goes through the outbox in `app/app/lib/email/outbox.server.ts`.
- DNS for mail lives in the Cloudflare zone: the Google Workspace verification TXT, MX, SPF and DKIM; for Resend the `resend._domainkey` TXT and the `send` and `rsend` CNAMEs (added by Resend's Cloudflare auto-configure).
- DMARC: one record, `p=none` with a `rua` address; reports go to Cloudflare DMARC Management. Tighten to `quarantine` once the mail passes.
- Secrets: `RESEND_API_KEY` and `EMAIL_SECRET` (local: `app/.dev.vars`; without a key, dev logs emails to the console).

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

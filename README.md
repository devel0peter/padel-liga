# Padelpárbaj

Domain: `padelparbaj.hu` (to be registered). The repo and internal identifiers keep the `padel-liga` name.

A platform for running weekly padel box leagues for **pairs**, starting in Győr.
Every pair plays one match per week inside a group of 4 pairs. At the end of each phase the group winner moves up and the last pair moves down.

Owner and Győr organizer: Peter. Built 100% AI-driven (vibe coded). The UI is **100% Hungarian**.

## Status

**Phase 0:** interest-collection landing page and conversations with the clubs. Nothing else gets built until there's real demand.

### Where we are (2026-10-02)
- Done:
  - Docs and decisions (see the log below).
  - App in `app/`, live on `https://padelparbaj.hu` since 2026-10-02.
  - Rules engine started in `packages/rules/`, with the fixture order tested.
  - `padelparbaj.hu` registered at Rackhost.
  - `padelparbaj.hu` on Cloudflare (Free plan, zone active). Nameservers: `keira.ns.cloudflare.com`, `yahir.ns.cloudflare.com`.
  - D1 database `padel-liga` created (WEUR); id in `app/wrangler.jsonc`. Migrations `0000`–`0004` applied remotely (2026-10-02).
  - Zone: Always Use HTTPS on.
  - Landing page moved into the app (`/`): signup form → `interest_signups` with server-side validation (unit tested) and a honeypot, privacy page at `/adatkezeles`, system dark mode, `hello@padelparbaj.hu` as contact.
  - Admin at `/admin` behind Cloudflare Access: signup list with filters, status, notes, CSV export, deletion.
  - Email (code in `app/app/lib/email/`): signup confirmation, one-time partner notice, admin broadcasts at `/admin/levelek` ("Levél nekik" on the filtered signup list), unsubscribe at `/leiratkozas`. Outbox table + hourly cron, within `EMAIL_DAILY_LIMIT`.
  - Resend: account created, `padelparbaj.hu` verified in the EU region via Cloudflare auto-configure (`resend._domainkey` TXT, `send` and `rsend` CNAMEs). Google Workspace DNS complete, including DKIM. One DMARC record (`p=none`).
- Next, in this order:
  1. ~~Nameservers and zone~~ ✅ zone active.
  2. ~~Google Workspace secondary domain~~ ✅ verification TXT, MX, SPF, DKIM, DMARC in Cloudflare DNS; `hello@` is an alias on Peter's user.
  3. ~~`www` → apex redirect~~ ✅ proxied `www` AAAA `100::` + Single Redirect rule (301, keeps path and query).
  4. Turn on Cloudflare DMARC Management; DMARC record `p=none` with its `rua`, tighten to `quarantine` once Google mail passes.
  5. ~~Email go-live~~ ✅ 2026-10-02: secrets set, code deployed, hourly cron registered. Cron triggers need an account-level `workers.dev` subdomain (`mracspeter`); the Worker itself stays off it (`workers_dev: false`). Still to do: a test signup with your own address and a test broadcast from `/admin/levelek/uj`.
  6. ~~First deploy~~ ✅ 2026-10-02, live on `https://padelparbaj.hu`. Deploys run from GitHub Actions on every push to `main` (migrations, then deploy; [devel0peter/padel-liga#1](https://github.com/devel0peter/padel-liga/issues/1)). (Access is set up: team `padelparbaj.cloudflareaccess.com`, app "Padelpárbaj admin" on `padelparbaj.hu/admin`, one-time PIN to `admin@padelparbaj.hu`.)
  7. ~~Partner notification email~~ ✅ built with step 5 (sent once per address).
- Backlog (ideas from 2026-10-02, not scheduled):
  - Signup counter on the landing page: "X pár jelentkezett, 8 kell az induláshoz".
  - Clubs on the platform (one feature, built when the first owner agrees): clubs belong to a city and are added only with the owner's consent to the poster and the listing. Brings the club list on the landing page (booking links), a per-club poster with QR code (`?ref=<club>` stored with each signup) and a signup count per club in the admin.
  - Cloudflare Web Analytics (cookieless, no consent banner), switched on at go-live.
  - Resend bounce and complaint webhooks → `email_suppressions` (Resend already suppresses hard bounces on its side).
  - Turnstile on the signup form, so bots can't burn the daily email quota.
  - Rename the `app/` workspace to `web/` (the nested `app/app/` comes from React Router's default `appDirectory`). Do it when no other session is mid-change.
- Waiting on Peter:
  - Messages to the 3 club owners (`docs/club-outreach.md`), including winter court capacity.

## Docs

| File | What it covers |
|---|---|
| `CLAUDE.md` | Instructions for the coding agent |
| `docs/spec.md` | Functional spec for the MVP (source of truth) |
| `docs/szabalyzat.md` | League rules, in Hungarian (user-facing draft). Rendered as-is on the site at `/szabalyzat` |
| `docs/go-to-market.md` | Clubs, recruiting, social content, organizer model |
| `docs/monetization.md` | Monetization ideas, running costs, things to keep in mind (ideas only, not scheduled) |
| `docs/club-outreach.md` | Messenger drafts for the club owners (poster request, feedback ask) and answers to likely questions |
| `docs/open-questions.md` | Undecided items to resolve before or while building |
| `app/` | Web app: React Router on Cloudflare Workers, shadcn/ui, D1 + Drizzle. Includes the Phase 0 landing page (`/`) and privacy page (`/adatkezeles`) |
| `packages/rules/` | Rules engine: pure TypeScript functions with Vitest tests |

## Decision log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-01 | Pairs, not individuals | That's how padel is played; people have fixed partners |
| 2026-10-01 | Individual Elo ratings alongside pairs | When partners switch, the new pair can be seeded correctly |
| 2026-10-01 | Groups of 4 pairs, round robin, promotion and relegation | Proven tennis box-league format |
| 2026-10-01 | Walkover goes to the side that actually tried to schedule | No-shows kill box leagues; activity has to be provable |
| 2026-10-01 | Scheduling happens on the platform (proposal and acceptance) | Without it the walkover rule can't be enforced |
| 2026-10-01 | City-wide, venue-neutral (all 3 Győr clubs) | More slots, easier scheduling; every club gains bookings |
| 2026-10-01 | Build our own platform, not Piramisbajnokság | Our own rules (walkover), lower integration cost, owned asset |
| 2026-10-01 | Multi-tenant (city/league) from day one | Later, other cities' organizers can use it |
| 2026-10-01 | Auth: email + password, Google, Facebook | Low friction for players |
| 2026-10-01 | Social: auto-generated content on our own channels, not posting in groups | Group spam would burn local trust |
| 2026-10-01 | Phase 0 first: landing page + interest list + talking to clubs | Validate demand before building |
| 2026-10-01 | Privacy page required from Phase 0 (spec section 17) | The landing page already collects personal data |
| 2026-10-01 | Both inactive = loss for both, scored 0-6 0-6 | Inactivity must cost in the tiebreakers too; consistent with walkovers |
| 2026-10-01 | Host on Cloudflare (Workers + D1 + R2 backups + Cron Triggers) | Very simple ops, one deploy, free tier likely enough |
| 2026-10-01 | Stack: TypeScript, React Router v8, Tailwind + shadcn/ui, Drizzle, Better Auth, Resend; replaces the proposed .NET stack | .NET doesn't run on Workers; React has the largest component ecosystem; React Router has a first-class Cloudflare template |
| 2026-10-01 | `.hu` domain at a Hungarian registrar, DNS on Cloudflare | Cloudflare Registrar does not sell `.hu`; Workers only need the zone on Cloudflare |
| 2026-10-01 | Brand: **Padelpárbaj**, leagues per city (e.g. "Padelpárbaj Győr") | Memorable, Hungarian, "pár" pun fits a pairs format. Padel-specific; another sport later would get its own brand on the same multi-tenant platform |
| 2026-10-01 | Rules engine as its own workspace package (`packages/rules`) | Keeps it pure and fully unit-tested, per CLAUDE.md |
| 2026-10-01 | Canonical host is the apex `padelparbaj.hu`; `www` 301-redirects; `workers.dev` disabled | One public URL, no duplicates |
| 2026-10-01 | `hello@padelparbaj.hu` is an alias in the Psionic Flare Google Workspace (`padelparbaj.hu` as secondary domain) | Free, real inbox, can send as `hello@`; Rackhost mailbox renews at 13,000 Ft/year |
| 2026-10-01 | App sends from `noreply@padelparbaj.hu` (Resend), Reply-To `hello@` | Keeps transactional mail apart from the human inbox |
| 2026-10-01 | First deploy only after the landing page is in the app (signup + privacy page) | Nothing public until the privacy page exists |
| 2026-10-02 | Match deadline = end of the phase; playing in the scheduled week is strongly recommended, not required | More forgiving; avoids walkovers over one busy week |
| 2026-10-02 | City is the tenant: signups (and later leagues, organizers) carry a city; the signup form has a city picker (Győr only for now). Rules and landing copy never name a city | Same platform for every city; inspired by piramisbajnoksag.hu |
| 2026-10-02 | Match format: 2 sets to 6 (tie-break at 6-6), super tie-break to 10 instead of a 3rd set, golden point (receivers choose who receives). One format per league, no per-match variants. 90-minute booking recommended; if time runs out, finish in a new slot | Standard amateur format; keeps set/game difference and Elo comparable. Pros (Premier Padel) play 3 full sets, which doesn't fit league court bookings |
| 2026-10-02 | Partner changes only between rounds (phases); pairs are fixed within a round. User-facing term for a phase is "kör" (rules no longer say "szakasz") | Group results stay meaningful; one term on the landing page and in the rules |
| 2026-10-02 | Substitutes allowed within a round with organizer approval (similar or lower level, not from the same group); result counts for the pair; Elo from who actually played | Opponents still get their match instead of a walkover |
| 2026-10-02 | Admin lives in the same app under `/admin`, not a separate `admin.` app. Admin login: `admin@padelparbaj.hu` (Access one-time PIN) | Shares DB, schema and migrations; organizer tools belong to the league app anyway; admin code is split out of the public bundle. Later: role checks via Better Auth, Access stays for platform-admin pages |
| 2026-10-02 | Admin (`/admin`) protected by Cloudflare Access; the Worker also verifies the Access JWT (fails closed if not configured). Signups: list, filter, search, status + private note, delete, CSV export | No auth code needed before Better Auth; free for a few admins |
| 2026-10-01 | Data controller: Psionic Flare Kft. (tax no. 29268782-2-19), which also owns the domain | Company seat as the postal contact; keeps Peter's home address off the site |
| 2026-10-01 | DMARC starts at `p=none`, reports to Cloudflare DMARC Management | Monitor before enforcing; avoids losing real mail to a setup mistake |
| 2026-10-01 | Always Use HTTPS now; HSTS only after a stable launch | HSTS is hard to undo |
| 2026-10-01 | No staging environment in Phase 0 | Local dev + prod is enough until the MVP season |
| 2026-10-01 | Backups: D1 Time Travel (30 days) for now; R2 exports before the MVP season | Phase 0 data is small; Time Travel is built in |
| 2026-10-01 | Resend in the EU region, set up together with signup confirmation emails | Data stays in the EU; Phase 0 sends no mail yet |
| 2026-10-01 | Ties of 3+: go back to head-to-head once only 2 pairs remain tied | FIFA/ITF practice; matches what players expect |
| 2026-10-01 | Phase 0 interest list goes in the app on padelparbaj.hu (D1), not Google Forms | Avoids migrating signups and links later; the domain and email setup were nearly done anyway |
| 2026-10-01 | Email: `hello@` via Google Workspace (padelparbaj.hu as a secondary domain); `noreply@` via Resend later | Reuses the existing Workspace; no extra mailbox cost |
| 2026-10-02 | Phases are 3 weeks back to back, no catch-up week; new groups emailed on Monday morning | 3 weeks is enough for 3 matches; revisit if the first week is lost to late scheduling |
| 2026-10-02 | Scoring 3/1/0 (win, played loss, walkover loss) | Showing up is rewarded; a walkover costs more than a lost match |
| 2026-10-02 | Both active but no agreement: unplayed, 0 points each; the organizer may award a walkover if one side clearly blocked | Mechanical by default, with an escape for obvious cases |
| 2026-10-02 | Late cancellation (<24 h) isn't a walkover; the canceller must re-propose and counts as inactive if the match isn't played by the deadline | Fits the end-of-phase deadline; illness isn't punished outright |
| 2026-10-02 | Pair counts not divisible by 4: 3-pair groups (2 matches, one week off), no waiting list | Nobody is turned away; promotion and relegation still work |
| 2026-10-02 | Elo starts at 1000/1200/1400/1600 by level | 200 per level closes quickly if someone misjudged |
| 2026-10-03 | No home pair: either pair may propose first (replaces the alternating home pair from 2026-10-02) | Faster scheduling; the walkover rule already counts a proposal from either side as activity |
| 2026-10-02 | Phone optional, only current opponents see it; email-only notifications in the MVP; partnerless players paired by hand; first season free | Less to build and less personal data for the first season |
| 2026-10-02 | Season start: when 8 pairs sign up, target November 2026 | Start while interest is fresh; winter court capacity to check with the clubs |
| 2026-10-02 | A club is added to the platform (its city's club list, its own poster QR code) only after the owner agrees to the poster and to being listed | Consent first; the outreach message stays a simple ask, the club features follow the yes |
| 2026-10-02 | CI/CD on GitHub Actions: checks on every PR and push; on `main`, D1 migrations then `wrangler deploy` (environment `production`). Conventional Commits enforced on PR commits by commitlint | Whole pipeline in the repo; a failed migration stops the deploy; Workers Builds runs migrations and tests less naturally |
| 2026-10-02 | Our D1 is the mailing list; Resend only delivers. Broadcasts are written in the admin (`/admin/levelek`) to the filtered signup list; later audiences (e.g. active players) are added as queries | One list, no sync with Resend Audiences; any audience is just a filter on our own data |
| 2026-10-02 | Every email goes through an outbox table, sent at once and by an hourly cron, within the daily quota (`EMAIL_DAILY_LIMIT`, Resend free = 100/day, 15 kept for signup emails) | Free plan is enough; a big broadcast spreads over days and never blocks signup confirmations; failed sends retry |
| 2026-10-02 | Broadcasts go only to the person who signed up, never to the partner they entered; signed one-click unsubscribe links, unsubscribes kept in `email_suppressions` | Spec section 17 (nothing else to the partner until they register); RFC 8058 for Gmail and Yahoo bulk-sender rules |

## Roadmap

0. **Validation:** landing page, interest list, talking to the 3 clubs, recruiting at weekend tournaments.
1. **MVP for the first Győr season:** registration, leagues and groups, scheduling, results, standings, promotion and relegation, Elo, email notifications.
2. **Season operations:** shareable result images, automatic social posts, organizer admin tools.
3. **Multi-city:** onboarding new organizers, organizer playbook.
   - Idea (2026-10-02, not MVP): an "Szervezz ligát a városodban" application form. Peter approves an applicant, who becomes the city's organizer and can create a league; the city then appears in the signup picker.
   - Demand first: the signup form's "Más város" option (done 2026-10-02) collects signups per city before it has an organizer, so a new organizer starts with a list of players.

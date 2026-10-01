# Padelpárbaj

Domain: `padelparbaj.hu` (to be registered). The repo and internal identifiers keep the `padel-liga` name.

A platform for running weekly padel box leagues for **pairs**, starting in Győr.
Every pair plays one match per week inside a group of 4 pairs. At the end of each phase the group winner moves up and the last pair moves down.

Owner and Győr organizer: Peter. Built 100% AI-driven (vibe coded). The UI is **100% Hungarian**.

## Status

**Phase 0:** interest-collection landing page and conversations with the clubs. Nothing else gets built until there's real demand.

### Where we are (2026-10-01)
- Done:
  - Docs and decisions (see the log below).
  - App scaffolded in `app/`. It isn't deployed yet.
  - Rules engine started in `packages/rules/`, with the fixture order tested.
  - `padelparbaj.hu` registered at Rackhost.
  - `padelparbaj.hu` added to Cloudflare (Free plan, zone pending). Nameservers: `keira.ns.cloudflare.com`, `yahir.ns.cloudflare.com`.
  - D1 database `padel-liga` created (WEUR); id in `app/wrangler.jsonc`. Migration `0000` applied remotely.
  - Zone: Always Use HTTPS on.
  - Landing page moved into the app (`/`): signup form → `interest_signups` with server-side validation (unit tested) and a honeypot, privacy page at `/adatkezeles`, system dark mode, `hello@padelparbaj.hu` as contact.
- Next, in this order:
  1. Nameservers switched at Rackhost (2026-10-01); wait for the zone to go active.
  2. Peter adds `padelparbaj.hu` as a secondary domain in the Psionic Flare Google Workspace; add the verification TXT, MX, SPF, DKIM and DMARC records in Cloudflare DNS; `hello@` becomes an alias on Peter's user.
  3. Add proxied `www` record + Redirect Rule `www` → apex (301).
  4. Turn on Cloudflare DMARC Management; DMARC record `p=none` with its `rua`, tighten to `quarantine` once Google mail passes.
  5. Set up Resend for `noreply@padelparbaj.hu` (EU region, sending records on its own subdomain) when signup confirmation emails are built.
  6. First deploy (custom domain `padelparbaj.hu` is in `app/wrangler.jsonc`). Before it: add the company seat to the privacy page (`app/app/lib/site.ts`) and apply migrations `0001` and `0002` remotely.
  7. Partner notification email (spec section 17: email the partner once); needs Resend (step 5).
- Waiting on Peter:
  - The Phase 0 questions in `docs/open-questions.md` (#4 contact details, #5 season start).
  - The MVP rules questions (#6–#12, plus the Elo start values and the home-pair alternation).

## Docs

| File | What it covers |
|---|---|
| `CLAUDE.md` | Instructions for the coding agent |
| `docs/spec.md` | Functional spec for the MVP (source of truth) |
| `docs/szabalyzat.md` | League rules, in Hungarian (user-facing draft) |
| `docs/go-to-market.md` | Clubs, recruiting, social content, organizer model |
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
| 2026-10-01 | Data controller: Psionic Flare Kft. (tax no. 29268782-2-19), which also owns the domain | Company seat as the postal contact; keeps Peter's home address off the site |
| 2026-10-01 | DMARC starts at `p=none`, reports to Cloudflare DMARC Management | Monitor before enforcing; avoids losing real mail to a setup mistake |
| 2026-10-01 | Always Use HTTPS now; HSTS only after a stable launch | HSTS is hard to undo |
| 2026-10-01 | No staging environment in Phase 0 | Local dev + prod is enough until the MVP season |
| 2026-10-01 | Backups: D1 Time Travel (30 days) for now; R2 exports before the MVP season | Phase 0 data is small; Time Travel is built in |
| 2026-10-01 | Resend in the EU region, set up together with signup confirmation emails | Data stays in the EU; Phase 0 sends no mail yet |
| 2026-10-01 | Ties of 3+: go back to head-to-head once only 2 pairs remain tied | FIFA/ITF practice; matches what players expect |
| 2026-10-01 | Phase 0 interest list goes in the app on padelparbaj.hu (D1), not Google Forms | Avoids migrating signups and links later; the domain and email setup were nearly done anyway |
| 2026-10-01 | Email: `hello@` via Google Workspace (padelparbaj.hu as a secondary domain); `noreply@` via Resend later | Reuses the existing Workspace; no extra mailbox cost |

## Roadmap

0. **Validation:** landing page, interest list, talking to the 3 clubs, recruiting at weekend tournaments.
1. **MVP for the first Győr season:** registration, leagues and groups, scheduling, results, standings, promotion and relegation, Elo, email notifications.
2. **Season operations:** shareable result images, automatic social posts, organizer admin tools.
3. **Multi-city:** onboarding new organizers, organizer playbook.
   - Idea (2026-10-02, not MVP): an "Szervezz ligát a városodban" application form. Peter approves an applicant, who becomes the city's organizer and can create a league; the city then appears in the signup picker.
   - Demand first: the signup form's "Más város" option (done 2026-10-02) collects signups per city before it has an organizer, so a new organizer starts with a list of players.

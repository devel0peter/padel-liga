# CLAUDE.md: instructions for the coding agent

## Sources of truth
- `docs/spec.md` defines the behaviour. If the code and the spec disagree, ask; don't guess.
- `docs/szabalyzat.md` holds the user-facing rules. The rules engine must follow it exactly.
- Record new decisions in the decision log in `README.md`.

## Language
- Everything the user sees is **Hungarian**: UI, emails, error messages, validation messages, page titles.
- Code, identifiers, commits and comments are in English.
- Hungarian formats:
  - Dates: `2026. 10. 01.` and `okt. 1., csütörtök`.
  - Time: 24-hour.
  - Decimal comma.
- Time zone: `Europe/Budapest`. Store UTC and display local time.
- The tone is informal ("tegező") and short.

## Quality rules
- The **rules engine** (standings, tiebreakers, walkovers, promotion and relegation, Elo, fixture generation) is a separate project or module made of pure functions, with **unit tests for every rule**. The UI may be rough; this part can't be.
- Every rule in the spec has at least one test. Edge cases: three-way ties, pairs dropping out mid-season, unplayed matches.
- Auth, emails and personal data: always flag them for human review in the PR or summary.
- Never expose another player's email or phone number on a public page.

## Stack
- TypeScript everywhere, npm workspaces.
- `app/`: React Router v8 (framework mode, server-rendered) on **Cloudflare Workers**.
- UI: Tailwind CSS v4 + **shadcn/ui** (`app/app/components/ui`). Prefer an existing shadcn component over custom markup: `npx shadcn@latest add <name>` in `app/`.
- Data: **Cloudflare D1** (SQLite) + **Drizzle ORM**. Schema in `app/app/db/schema.ts`, migrations in `app/drizzle/`. Access the DB only from `*.server.ts` modules.
- Auth: **Better Auth** (email + password, Google, Facebook). Not installed yet.
- Email: **Resend** (EU), called with plain `fetch`, no SDK. All mail goes through the outbox in `app/app/lib/email/outbox.server.ts`; templates are pure functions in `templates.ts`. Secrets: `RESEND_API_KEY`, `EMAIL_SECRET` (local: `app/.dev.vars`; without a key, dev logs emails to the console).
- Scheduled jobs (deadlines, reminders, auto-confirm): Cloudflare **Cron Triggers**.
- `packages/rules/`: the rules engine. Pure TypeScript, no I/O and no Cloudflare imports, tested with **Vitest**.

## Commands (from the repo root)
- `npm run dev`: local dev server with a local D1.
- `npm test`: rules engine tests.
- `npm run typecheck`, `npm run build`.
- `npm run db:generate -w app -- --name <name>` after a schema change, then `npm run db:migrate:local -w app`.
- `npm run deploy`: deploy to Cloudflare. Ask first.

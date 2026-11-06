# Padelpárbaj

Weekly padel box leagues for **pairs**, starting in Győr, Hungary. Every pair plays one match per week inside a group of 4 pairs; at the end of each phase the group winner moves up and the last pair moves down. Live at **https://padelparbaj.hu**. The UI is 100% Hungarian. Built AI-driven (vibe coded) by Peter, who is also the Győr organizer. The repo and internal identifiers keep the `padel-liga` name.

**About this repository:** it is public only to use GitHub's free tooling. It is a personal project, not open source: no license is granted (all rights reserved), and outside issues and pull requests are not accepted ([CONTRIBUTING.md](CONTRIBUTING.md)). Security reports: [SECURITY.md](SECURITY.md).

## Where it stands

The first Győr season is set up and round 1 starts on 9 Nov 2026. Open work is tracked in the [GitHub issues](https://github.com/devel0peter/padel-liga/issues) and [milestones](https://github.com/devel0peter/padel-liga/milestones).

## Stack

- `app/`: React Router (framework mode, server-rendered) on Cloudflare Workers, Tailwind CSS + shadcn/ui, Cloudflare D1 with Drizzle ORM, own small auth module (Google or an emailed one-time code), email via Google Workspace SMTP with Resend as fallback.
- `packages/rules/`: the rules engine (standings, tiebreakers, walkovers, promotion and relegation, Elo, fixtures). Pure TypeScript, no I/O, tested with Vitest.
- TypeScript everywhere, npm workspaces. Scheduled jobs run as Cloudflare Cron Triggers.

## Run it locally

```
npm ci
npm run dev                          # dev server with a local D1
npm run db:migrate:local -w app      # apply migrations to the local D1
npm run db:seed:local -w app         # fake data for the walkthrough
npm test                             # rules engine tests
npm run typecheck
npm run build
npm run e2e                          # browser suite; once: npx playwright install chromium
```

Without an email key, the dev server prints emails to the console (secrets go in `app/.dev.vars`).

## Docs

| File | What it covers |
|---|---|
| [docs/spec.md](docs/spec.md) | Functional spec (source of truth for behaviour) |
| [docs/szabalyzat.md](docs/szabalyzat.md) | League rules, in Hungarian; shown on the site at `/rules` |
| [docs/decisions.md](docs/decisions.md) | Decision log: every product and technical decision, with its reason |
| [docs/operations.md](docs/operations.md) | Hosting, DNS and email setup, backups and how to restore them |
| [docs/walkthrough.md](docs/walkthrough.md) | Click-through checklist on a local database |
| [docs/e2e-tests.md](docs/e2e-tests.md) | The end-to-end suite and the `e2e-tester` agent |
| [docs/archive/](docs/archive) | Finished plans, kept as history |
| [CLAUDE.md](CLAUDE.md) | Instructions for the coding agent (workflow, commands, conventions) |

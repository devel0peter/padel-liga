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

## Proposed stack (to be confirmed, see open-questions)
- .NET 10, ASP.NET Core, Razor Pages or Blazor SSR.
- EF Core with PostgreSQL (SQLite allowed in dev).
- ASP.NET Identity with email + password, Google and Facebook external logins.
- Transactional email provider (to be decided).
- Hosting: Docker, on the homelab behind Cloudflare Tunnel or on a cheap VPS.

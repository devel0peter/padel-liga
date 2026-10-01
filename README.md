# Padel Liga (working title)

A platform for running weekly padel box leagues for **pairs**, starting in Győr.
Every pair plays one match per week inside a group of 4 pairs. At the end of each phase the group winner moves up and the last pair moves down.

Owner and Győr organizer: Peter. Built 100% AI-driven (vibe coded). The UI is **100% Hungarian**.

## Status

**Phase 0:** interest-collection landing page and conversations with the clubs. Nothing else gets built until there's real demand.

## Docs

| File | What it covers |
|---|---|
| `CLAUDE.md` | Instructions for the coding agent |
| `docs/spec.md` | Functional spec for the MVP (source of truth) |
| `docs/szabalyzat.md` | League rules, in Hungarian (user-facing draft) |
| `docs/go-to-market.md` | Clubs, recruiting, social content, organizer model |
| `docs/open-questions.md` | Undecided items to resolve before or while building |
| `landing/index.html` | Phase 0 interest-collection page |

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

## Roadmap

0. **Validation:** landing page, interest list, talking to the 3 clubs, recruiting at weekend tournaments.
1. **MVP for the first Győr season:** registration, leagues and groups, scheduling, results, standings, promotion and relegation, Elo, email notifications.
2. **Season operations:** shareable result images, automatic social posts, organizer admin tools.
3. **Multi-city:** onboarding new organizers, organizer playbook.

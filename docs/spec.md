# MVP spec

Status: draft v0.1 (2026-10-01). Items marked ❓ are open, see `open-questions.md`.

## 1. Goal
Pairs who play padel in Győr get a fixed weekly match against opponents at their level, with fair rules on no-shows. The organizer has almost no admin work.

## 2. Roles
| Role | Can do |
|---|---|
| Visitor | See the landing page, rules and public standings |
| Player | Register, form a pair, join a league, propose and accept slots, record results |
| Organizer | Create and configure a league and season, seed groups, settle disputes, override results |
| Platform admin | Create cities/leagues, appoint organizers (Peter) |

## 3. Authentication
- Email + password, with email confirmation and password reset.
- Google login.
- Facebook login.
- Linking several login methods to one account (same email = same account, after confirmation).
- Profile:
  - Required: name, email.
  - Optional: phone number (visible only to opponents in the current round ❓), self-assessed level.
- GDPR:
  - Privacy notice and consent at registration.
  - Account deletion with anonymization: match history stays, the name becomes "Törölt játékos".

## 4. Domain model (simplified)
- **League:** city, name, organizer(s), configuration (see section 11).
- **Season:** a run of the league (e.g. "2027 tavasz"), made up of phases.
- **Phase:** 3 weeks (❓ plus 1 catch-up week). Group composition is fixed within a phase.
- **Group:** 4 pairs, ordered by level (1. csoport = strongest).
- **Pair:** 2 players. A pair is a separate entity; a player can be in at most one active pair per league.
- **Match:** 2 pairs, a deadline, a status, proposals, a result, and a venue (one of the 3 clubs).
- **Proposal:** concrete time slots from one pair to the other.
- **Rating:** individual Elo per player.

## 5. Fixtures
- Groups of 4 give 3 rounds per phase, 2 matches per round, and each pair plays once a week.
- Round order is generated automatically: week 1 is 1–4 and 2–3, week 2 is 1–3 and 2–4, week 3 is 1–2 and 3–4, based on seeding.
- Each match has a deadline: the end of its week (Sunday 23:59).
- The "home" pair is responsible for proposing the first slots. Home is decided by alternation.

## 6. Scheduling (core feature)
1. Either pair can make a proposal: **at least 3 slots, spread over at least 2 different days, between 07:00 and 22:00, at least 48 hours ahead of now**, before the deadline. Optionally with a venue.
2. The other pair can:
   - **accept** one slot, which schedules the match, or
   - **counter-propose** with a new proposal under the same rules.
   Simply rejecting is not possible.
3. Once a slot is accepted, whoever books the court records which club and court they booked (manual confirmation; no SportMate integration).
4. Every action is timestamped and logged. This is the evidence for walkovers.
5. Either side can cancel an accepted slot; this reopens the proposal process.
   ❓ Is a late cancellation (under 24 hours) a walkover?

## 7. Recording results
- Format: ❓ (proposal: 2 winning sets, the third set replaced by a super tie-break to 10, golden point).
- One pair records the result, and the other confirms or disputes it.
- Not confirmed within 48 hours: the result is accepted automatically.
- A disputed result goes to the organizer, who decides.

## 8. Unplayed matches (resolved automatically at the deadline)
"Valid activity" means a valid proposal or counter-proposal before the deadline.

| Situation | Outcome |
|---|---|
| One side active, the other did nothing (no response or no proposal) | Walkover win for the active side: 6-0 6-0 |
| Both active, no agreement | 0 points for both sides, no Elo change ❓ |
| Neither side active | Both sides get a loss |
| Accepted slot, one side didn't show up | The side that showed up reports it, the organizer confirms, walkover |

The organizer can always override the outcome manually.

## 9. Standings and tiebreakers
Order within a group:
1. Matches won.
2. Head-to-head result (only when 2 pairs are tied).
3. Set difference.
4. Game difference.
5. Elo (average of the pair).

Points: ❓ (win/loss count only, or 3/1/0 where a loss after a played match is worth 1 point, rewarding pairs who show up).

## 10. Promotion and relegation
- At the end of a phase, 1st place moves up a group and 4th place moves down. The top group has no promotion and the bottom group has no relegation.
- New pairs: placed by the average Elo of the pair, or by self-assessed level if they have no rating.
- Pairs leaving mid-season and empty spots: the organizer fills them from the waiting list; the rules engine suggests a placement.
- An odd number of pairs: ❓ (a group of 3 or 5, or a waiting list).

## 11. Rating (Elo)
- Individual Elo, starting value based on self-assessed level (kezdő 1000, középhaladó 1200, haladó 1400, profi 1600 ❓).
- Pair rating = average of the two players.
- After a match, both players receive the same delta. K = 32 at first, 16 after 20 matches.
- Walkovers don't change Elo.

## 12. League configuration (per league, for multi-city)
Group size, phase length in weeks, catch-up week on or off, deadline day, slot rules (minimum number of slots and days, time window, lead time), match format, scoring system, walkover rules, list of venues.

## 13. Notifications (email, in Hungarian)
- New round, with the opponent and the deadline.
- A proposal arrived, or a slot was accepted.
- Reminder: 3 days before the deadline if the match is still unscheduled.
- A result is waiting for confirmation.
- End of a phase, with your new group.
- Every notification includes a shareable link ("küldd el a párodnak / ellenfélnek").

❓ Push notifications or a PWA later.

## 14. Public pages
- League home: groups, standings, matches this week.
- Pair and player profiles: results and Elo history (no contact details).
- Rules page (`szabalyzat.md`).

## 15. Out of MVP scope
Payment, court booking integration, chat, mobile app, multi-language support, social auto-posting (phase 2).

## 16. Non-functional requirements
- Mobile-first; most usage will be from a phone link.
- Hungarian characters everywhere (ő, ű), including email subject lines.
- Backups: daily database dump.
- Logs: an audit log for every match status change.

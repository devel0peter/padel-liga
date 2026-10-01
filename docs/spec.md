# MVP spec

Status: draft v0.1 (2026-10-01). Items marked ❓ are open, see `open-questions.md`.

## 1. Goal
Pairs who play padel in a city (starting with Győr) get a fixed weekly match against opponents at their level, with fair rules on no-shows. The organizer has almost no admin work.

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
  - Privacy notice (section 17) and consent at registration.
  - Account deletion with anonymization: match history stays, the name becomes "Törölt játékos".

## 4. Domain model (simplified)
- **City (tenant):** slug and name. Signups, leagues and organizers belong to a city. Only cities with an organizer can be picked; in the MVP that is Győr alone. The signup form also offers "Más város" with a free-text city name, to measure demand where there is no league yet (a typed name matching a supported city is filed under that city). User-facing text never hard-codes a city.
- **League:** city, name, organizer(s), configuration (see section 12).
- **Season:** a run of the league (e.g. "2027 tavasz"), made up of phases.
- **Phase:** 3 weeks (❓ plus 1 catch-up week). Group composition is fixed within a phase.
- **Group:** 4 pairs, ordered by level (1. csoport = strongest).
- **Pair:** 2 players. A pair is a separate entity; a player can be in at most one active pair per league.
- **Match:** 2 pairs, a scheduled week, a deadline, a status, proposals, a result, and a venue (one of the city's clubs).
- **Proposal:** concrete time slots from one pair to the other.
- **Rating:** individual Elo per player.

## 5. Fixtures
- Groups of 4 give 3 rounds per phase, 2 matches per round, and each pair plays once a week.
- Round order is generated automatically: week 1 is 1–4 and 2–3, week 2 is 1–3 and 2–4, week 3 is 1–2 and 3–4, based on seeding.
- Each match has a **scheduled week** (its round) and a **deadline: the end of the phase** (Sunday 23:59 of the last week). Playing in the scheduled week is strongly recommended; the UI and emails nudge towards it, but a match can be played any time until the deadline.
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
The deadline is the end of the phase (section 5), so a match missed in its scheduled week can still be played later in the phase.
"Valid activity" means a valid proposal or counter-proposal before the deadline.

| Situation | Outcome |
|---|---|
| One side active, the other did nothing (no response or no proposal) | Walkover win for the active side: 6-0 6-0 |
| Both active, no agreement | 0 points for both sides, no Elo change ❓ |
| Neither side active | Both sides get a loss, recorded as 0-6 0-6 for each (counts in set and game difference) |
| Accepted slot, one side didn't show up | The side that showed up reports it, the organizer confirms, walkover |

The organizer can always override the outcome manually.

## 9. Standings and tiebreakers
Order within a group:
1. Matches won.
2. Head-to-head result (only when 2 pairs are tied).
3. Set difference.
4. Game difference.
5. Elo (average of the pair).

Set and game difference are counted over all of the pair's matches in the group in that phase, including walkovers.

When 3 or more pairs are tied, apply steps 3–5 in order. As soon as a step separates one or more pairs and only 2 are still tied with each other, go back to step 2 (head-to-head) for those 2.
Example: A beat B, B beat C, C beat A, so all have 2 wins. A has the best set difference and is 1st. B and C are still tied, and B beat C, so B is 2nd.

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
- Reminder at the end of the scheduled week if the match is still unplayed ("pótoljátok a kör végéig").
- Reminder: 3 days before the deadline if the match is still unscheduled.
- A result is waiting for confirmation.
- End of a phase, with your new group.
- Every notification includes a shareable link ("küldd el a párodnak / ellenfélnek").

❓ Push notifications or a PWA later.

## 14. Public pages
- League home: groups, standings, matches this week.
- Pair and player profiles: results and Elo history (no contact details).
- Rules page (`szabalyzat.md`).
- Privacy page ("Adatkezelési tájékoztató", section 17), linked from the footer and from every consent checkbox.

## 15. Out of MVP scope
Payment, court booking integration, chat, mobile app, multi-language support, social auto-posting (phase 2).

## 16. Non-functional requirements
- Mobile-first; most usage will be from a phone link.
- Hungarian characters everywhere (ő, ű), including email subject lines.
- Backups: D1 point-in-time restore (30 days) plus a daily export to R2 via a Cron Trigger.
- Logs: an audit log for every match status change.

## 17. Privacy page (Adatkezelési tájékoztató)
A short, plain-language Hungarian page. Needed from Phase 0, since the landing page already collects personal data. Contents:
- **Who handles the data:** the organizer (Peter), with a contact email.
- **What we collect:**
  - Landing page: names, emails, level, comment.
  - Later: account data, an optional phone number, match history, ratings.
- **Why:** only to organize the league and send league emails. No marketing for third parties, and no selling of data.
- **Who sees what:**
  - Public: names, results, standings and ratings.
  - Never public: email and phone number.
  - Phone number: only the current opponent sees it (❓ see section 3).
- **Where it is stored:** Cloudflare (D1 database with EU location, backups in R2). Processors to list: Cloudflare (hosting, database) and Resend (email).
- **Retention:**
  - Interest list: deleted after the first season starts, unless the person registers.
  - Accounts: kept until deletion, then anonymized (section 3).
- **Your rights:** access, correction, deletion and withdrawing consent, by emailing the contact address.
- **Partner's data:** when someone signs up a pair, they enter their partner's name and email. We email the partner once, so they know about it and can ask for deletion. Nothing else is sent to them until they register themselves.

# MVP spec

Status: draft v0.3 (2026-10-03). All open questions resolved; see `open-questions.md`. MVP plan and calendar: section 18.

## 1. Goal
Pairs who play padel in a city (starting with Győr) get a fixed weekly match against opponents at their level, with fair rules on no-shows. The organizer has almost no admin work.

## 2. Roles
| Role | Can do |
|---|---|
| Visitor | See the landing page, rules and public standings |
| Player | Register, form a pair, join a league, propose and accept slots, record results |
| Organizer ("Szervező") | Per league: create and configure seasons, approve pairs, seed groups, publish rounds, approve substitutes, settle disputes, override results, withdraw pairs. Edits the clubs (venues) of the league's city |
| Platform admin ("Admin") | Create cities/leagues, appoint organizers, see the interest list, send broadcasts, see traffic and users (Peter) |

Organizer and platform admin are roles on a normal player account, inside the app. The current `/admin` (interest list, broadcasts) moves into the app under the platform admin role, and Cloudflare Access is retired (2026-10-03).
- Code names: `player`, `league_admin`, `superadmin`; UI labels: Játékos, Szervező, Admin (2026-10-04).
- Organizer rights are granted per league (a row per league and account), so one account can organize one league and not another.
- Platform admin is a flag on the account, set only by a CLI command; no screen can grant or remove it. Peter's work Google account is the platform admin; his personal account is a player and the Győr organizer.
- Design and delivery: `docs/admin-plan.md`.

## 3. Authentication
- **No passwords** (2026-10-04): log in with Google, or with a one-time 6-digit code sent by email (valid 10 minutes, at most 5 tries, single use). Nothing to hash, reset or leak.
- Sessions last 90 days and are extended while used; platform admin sessions 12 hours. Logout, and logout on every device.
- Until registration opens (2 Nov 2026), only invited emails can create an account.
- First login asks for a name and privacy consent.
- Facebook login: after the MVP (Meta business verification and app review take weeks).
- Onboarding from the interest list: when registration opens, the players who start with a partner from the signup get one invite email each with a registration link, their email pre-filled: both addresses of a pair signup, and both solos once a Szervező paired them. A solo still waiting for a partner gets none. For the first season everyone starts with that partner: the pair forms by itself once both have registered (section 4; README decision log, 2026-10-24, #89).
- Same email = same account, whichever way they log in. A Google login links to an existing account only if Google reports the email as verified.
- Profile:
  - Required: name, email.
  - Required: self-assessed level (kezdő / középhaladó / haladó / versenyző; asked at first login, prefilled from the interest signup with the same email; accounts that predate it are prompted on the home page, and the level is required to apply for a season).
  - Optional: phone number (Hungarian numbers only, stored as +36…, shown as `+36 30 123 4567`; visible only to opponents in the current round, never public; collected at registration, not on the interest form). Name, level and phone are editable on the profile page.
- GDPR:
  - Privacy notice (section 17) and consent at registration.
  - Account deletion with anonymization: match history stays, the name becomes "Törölt játékos".

## 4. Domain model (simplified)
- **City (tenant):** slug and name, managed by the platform admin at `/admin/cities` (2026-10-05). Signups, clubs, leagues and organizers belong to a city. A city marked "listed" is offered on the signup form and the landing page; only cities with an organizer should be listed (in the MVP, Győr alone). Adding a city files the earlier "Más város" signups that typed its name under it. The signup form also offers "Más város" with a free-text city name, to measure demand where there is no league yet (a typed name matching a supported city is filed under that city). User-facing text never hard-codes a city.
- **League:** city, name, organizer(s), configuration (see section 12).
- **Season:** a run of the league (e.g. "2026/27 tél", free text set by the organizer), made up of **4 phases** (12 weeks). It has a registration window and a calendar of phases, with optional breaks between phases (e.g. 21 Dec – 3 Jan); no phase runs during a break. Seasons follow each other with a 1–2 week gap, set by the organizer. The league is continuous: a season is a checkpoint (an end date, a recap, a re-entry point, division and group winners). Season end and switch: section 10.
- **Season entry:** a pair applies to a season ("Nevezünk"); the organizer approves or rejects. Pairs approved after the first phase has started join at the start of the next phase, placed by the late-joiner rules (section 10). A pair approved during the last phase moves into the next season automatically, without re-entering. Who can apply, when, and what dissolving a pair does to its entries: README decision log, 2026-10-24 (#23).
- **Venue:** the city's padel clubs, an internal list the organizer maintains, used when recording where a match was booked (and for per-club statistics). Never listed publicly; the same list feeds the poster QR codes and the optional "where do you play most" signup field (README decision log, 2026-10-04).
- **Phase:** 3 weeks, back to back: the next phase starts on the Monday after the deadline, and new groups are emailed that Monday morning. Group composition is fixed within a phase. (A catch-up week exists as a league setting, off by default; revisit if the first week of a phase turns out to be lost.)
- **Group:** 4 pairs, ordered by level (1. csoport = strongest). When the number of pairs isn't divisible by 4, some groups have 3 pairs (9 = 3+3+3, 10 = 4+3+3, 11 = 4+4+3); no waiting list. 3-pair groups go at the bottom unless the organizer places them otherwise.
- **Division** (internal until the season is announced; nothing on the public site or in `szabalyzat.md` yet, draft text in `szabalyzat-divisions-draft.md`): a virtual third of the ladder, named after the MAPASZ (Hungarian Padel Federation) tournament levels: **Bronz** (top), **Réz**, **Rookie** (bottom), shown as "Bronz divízió" etc. The names only borrow the federation's vocabulary: the league is not a MAPASZ tournament and gives no ranking points (README decision log, 2026-10-23). Still one ladder: divisions don't change fixtures, promotion or relegation, only labels and season-end prizes (README decision log, 2026-10-08).
  - Sizes from the number of groups `n` in the phase: each division gets `floor(n / 3)` groups; a remainder of 1 goes to Réz, a remainder of 2 to Réz and Rookie (15 = 5+5+5, 16 = 5+6+5, 17 = 5+6+6). With fewer than 3 groups, top-down: 1 group = Bronz; 2 groups = Bronz, Réz.
  - Recalculated every phase, so the borders move as groups are added or removed. A pair's division is the division of its current group.
  - The signup level "versenyző" has no division of its own.
- **Pair:** 2 players. A pair is a separate entity; a player can be in at most one active pair per league. Pairs are fixed within a phase: forming a new pair or changing partner is only possible between phases. A pair is formed by one player inviting the other by email; the pair exists once the invitee accepts. Invites, refusals and dissolving a pair: README decision log, 2026-10-24. A pair named on the interest signup (section 3) forms without an invite, when the second of the two finishes registering, if neither player's own newer signup names someone else or nobody, and unless either is already in an active pair in that league. It forms only once: after a dissolve it doesn't come back.
- **Withdrawal:** if a pair drops out mid-phase (injury, moving away), the organizer withdraws it: all its matches in that phase, played or not, are removed from the group's standings, and the group continues without it. No replacement mid-phase.
- **Substitute:** if a player can't play (injury, illness, absence), the pair may field a substitute for one or more matches in the current phase, with the organizer's approval before the match. Rules:
  - The pair requests it, naming the substitute; the organizer sees the substitute's and the absent player's Elo side by side and approves or rejects. The opponents are notified and see the substitute on the match page.
  - The substitute needs an account (for Elo) and must not be in another pair of the same group.
  - The substitute's level should be similar to or lower than the absent player's; the organizer judges.
  - The result counts for the pair as normal (standings, set and game difference).
  - Without an approved substitute, the unplayed-match rules apply (section 8).
- **Match:** 2 pairs, a scheduled week, a deadline, a status, proposals, a result, and a venue (one of the city's clubs).
- **Proposal:** concrete time slots from one pair to the other.
- **Rating:** individual Elo per player.

## 5. Fixtures
- Groups of 4 give 3 rounds per phase, 2 matches per round, and each pair plays once a week.
- Round order is generated automatically: week 1 is 1–4 and 2–3, week 2 is 1–3 and 2–4, week 3 is 1–2 and 3–4, based on seeding.
- Groups of 3 use the same order with seed 4 as a bye: week 1 is 2–3 (1 rests), week 2 is 1–3 (2 rests), week 3 is 1–2 (3 rests). Each pair plays 2 matches.
- Each match has a **scheduled week** (its round) and a **deadline: the end of the phase** (Sunday 23:59 of the last week). Playing in the scheduled week is strongly recommended; the UI and emails nudge towards it, but a match can be played any time until the deadline.
- There is no "home" pair: either pair may make the first proposal (section 6), so scheduling starts as soon as either side is ready.

## 6. Scheduling (core feature)
1. Either pair can make a proposal: **at least 3 slots, spread over at least 2 different days, between 07:00 and 22:00, at least 48 hours ahead of now**, before the deadline. Optionally with a venue.
2. The other pair can:
   - **accept** one slot, which schedules the match, or
   - **counter-propose** with a new proposal under the same rules.
   Simply rejecting is not possible.
3. **Agreed time (README decision log, 2026-10-05):** if the pairs already agreed on a time elsewhere (Messenger, in person), either pair can record that slot directly, without the 3-slot proposal: any future time before the deadline, no lead time, no time window. Optionally with a venue. The other pair confirms it, which schedules the match as if a slot had been accepted, or declines it, which reopens the proposal process. An unconfirmed agreed time lapses when its start passes.
4. Once a slot is accepted, whoever books the court records which club and court they booked (manual confirmation; no SportMate integration).
5. Every action is timestamped and logged. This is the evidence for walkovers.
6. Either side can cancel an accepted or confirmed slot; this reopens the proposal process.
   - **Late cancellation (under 24 hours before the slot):** not an immediate walkover. The cancelling side must make the next proposal. If the match isn't played by the deadline, the cancelling side counts as the inactive side in section 8 (walkover for the other side), regardless of its earlier activity.

## 7. Recording results
- Format (league default, one format per league, no per-match variants; see section 12):
  - Best of 2 sets. Short sets: a set goes to 4 games (win by 2); at 4-4 a regular tie-break to 7 (win by 2).
  - At 1-1 in sets, a super tie-break to 10 (win by 2) replaces the third set.
  - Golden point: no advantage at deuce, one point decides; the receiving pair chooses which player receives.
  - For set and game difference the super tie-break counts as one set and as a 1-0 game (ITF convention).
- Court booking: 60 minutes is usually enough (Győr clubs only take 60-minute bookings).
- Court time runs out: the match is unfinished. The pairs note the score and finish it from there in a new slot before the deadline. Only the final result is recorded.
- One pair records the result, and the other confirms or disputes it.
- Not confirmed within 48 hours: the result is accepted automatically.
- A disputed result goes to the organizer, who decides.

## 8. Unplayed matches (resolved automatically at the deadline)
The deadline is the end of the phase (section 5), so a match missed in its scheduled week can still be played later in the phase.
"Valid activity" means a valid proposal or counter-proposal, recording an agreed time, or confirming one, before the deadline.

| Situation | Outcome |
|---|---|
| One side active, the other did nothing (no response or no proposal) | Walkover win for the active side: 4-0 4-0 |
| Both active, no agreement | Unplayed: 0 points for both sides, no Elo change, not counted in set and game difference. The organizer may award a walkover if the log shows one side clearly blocked the match |
| Neither side active | Both sides get a loss, recorded as 0-4 0-4 for each (counts in set and game difference, 0 points) |
| Late cancellation, then not played by the deadline | The cancelling side counts as inactive: walkover for the other side (section 6) |
| Accepted slot, one side didn't show up | The side that showed up reports it, the organizer confirms, walkover |

The organizer can always override the outcome manually.

### Strikes ("fekete pont", README decision log, 2026-10-05)
- **A strike goes to both players of a pair** when:
  - it didn't show up at an accepted slot (organizer-confirmed no-show), or
  - it is the inactive side at the deadline: one side active and this one not, neither side active (both pairs get one), or the late-cancelling side counted as inactive (section 6).
- **No strike** when both sides were active but didn't agree, for a cancellation more than 24 hours before the slot, or for matches removed by a withdrawal.
- A substitute (section 4) never gets a strike; the pair's two players do.
- Strikes belong to the player and follow them across partner changes. They reset at the start of each season.
- **2nd strike:** a warning email to the player.
- **3rd strike:** the player's pair leaves the league at the end of the current phase, not immediately, so that phase's results (including the walkovers its opponents won) stand. At the round switch, apply promotion and relegation first, then remove the pair and re-cut the groups top-down so pairs below move up into the hole (as in the season carry-over, section 10). The player's partner may form a new pair (placed as a re-formed pair). The removed player's next season entry is flagged for the organizer, who decides on approval.
- The organizer can cancel a strike with a reason (illness, a club cancelling the court); the cancellation is logged and the count is recomputed.

## 9. Standings and tiebreakers
Points: win 3, loss in a played match 1, walkover loss (or a loss because neither side was active) 0.

Order within a group:
1. Points.
2. Head-to-head result (only when 2 pairs are tied).
3. Set difference.
4. Game difference.
5. Elo (average of the pair).

Set and game difference are counted over all of the pair's matches in the group in that phase, including walkovers.

When 3 or more pairs are tied, apply steps 3–5 in order. As soon as a step separates one or more pairs and only 2 are still tied with each other, go back to step 2 (head-to-head) for those 2.
Example: A beat B, B beat C, C beat A, so all have 2 wins. A has the best set difference and is 1st. B and C are still tied, and B beat C, so B is 2nd.


## 10. Promotion and relegation
- At the end of a phase, 1st place moves up a group and last place (4th, or 3rd in a group of 3) moves down. The top group has no promotion and the bottom group has no relegation.
- **Fast calibration after the first phase of a league's first season** (README decision log, 2026-10-08): seeding then rests only on self-assessed levels, so movement is faster once. At each border between two adjacent groups, **2 pairs swap** (the upper group's last two go down, the lower group's top two go up) when both groups have 4 pairs; 1 pair swaps when either group has 3. A group of 4 between two groups of 4 therefore sends its 1st and 2nd up and its 3rd and 4th down. Every later switch is 1 up / 1 down. League setting: the number of fast switches (default 1, the first switch only).
- **New pairs after the first phase** (late entries and pairs re-formed by a partner change) are placed by these rules, so they neither start at the bottom nor push earlier pairs down for free (README decision log, 2026-10-04):
  1. **Placement rating:** each player's Elo, minus 100 if the player has no rated match yet (their rating is still only the self-assessed starting value; a match as a substitute counts as rated). Pair placement rating = average of the two.
  2. **Target group:** the highest group, other than the top group, whose average pair Elo is at most the new pair's placement rating; the bottom group if there is none. With a single group, that group.
  3. **Free spot first:** if the target group has fewer than 4 pairs, the new pair goes there. Otherwise into the nearest group below it with fewer than 4 pairs (a 3-pair group or a spot left by a withdrawal).
  4. **No free spot at or below the target:** the new pair goes into the target group, and from there down each group passes its lowest-Elo pair one group down; the bottom groups are re-cut to the sizes in section 4. Groups above the target don't change.
  5. Several new pairs are placed one by one, highest placement rating first, after promotion and relegation of the continuing pairs.
  6. The result is part of the round switch draft; the organizer can move pairs before publishing.
- First phase of a season: the system sorts the approved pairs by average Elo (no discount, no cap) into groups of 4 (and 3, section 4); the organizer can move pairs between groups, then publishes. Publishing creates the phase's matches, emails every player and locks the groups (README decision log, 2026-10-24, #24).
- **Round switch:** after the deadline (Sunday 23:59) the system resolves unplayed matches (section 8) and drafts the next phase's groups (promotion, relegation, newly approved pairs). The organizer reviews it, settles open disputes and publishes on Monday morning; publishing sends the new-phase emails.
- **Season end and switch** (README decision log, 2026-10-05):
  1. **Final standings:** each pair's group and place in the last phase.
  2. **Winners** (README decision log, 2026-10-08), from the last phase's standings, before the last promotion and relegation:
     - **Divízió győztes:** 1st place of each division's top group (with 15 groups: groups 1, 6 and 11).
     - **Csoportgyőztes:** 1st place of every group. In a division's top group, this is the division winner.
     - **Eligibility:** both players of the pair played in at least 2 phases of the season as a pair member (substitute appearances don't count; the 2 phases may be with different partners). If an ineligible pair wins a group, the result and promotion stand, and the prize goes to the group's best-placed eligible pair (none if there is none). The group card shows the ineligible pair as "Ebben a szezonban még nem díjjogosultak". This keeps a strong pair that joins in the last phase with an understated level from taking a prize, without anyone judging the players.
     - The prizes and their sponsors are set by the organizer per season and division (free text, e.g. "Felajánlja: Padel Club Győr"); the app shows them, nothing is paid or handed out in the app. Prizes are handed over at a short meeting at the sponsor club after the season (group photo, no matches), arranged by the organizer with the club.
  3. **Re-entry:** during the next season's registration window, continuing pairs click "Nevezünk újra"; the organizer can also re-enter a pair by hand. Pairs that don't re-enter leave the league. A pair approved for a season it never played in (approved during the last phase) moves into the next season automatically.
  4. **Carry-over draft:** apply the last phase's promotion and relegation as at a round switch. List the resulting groups top-down, each group's pairs ordered by last-phase group, then place. Remove pairs that didn't re-enter and pairs whose players changed. Re-cut the remaining order top-down into groups of the section 4 sizes, so pairs below move up into the holes. Then place new pairs and re-formed pairs (partner change) by the late-joiner rules above.
  5. The organizer adjusts the draft and publishes it on the Monday the new season starts; publishing sends the new-phase emails.
  6. **Elo carries over** unchanged; no reset or decay.
  7. **Season archive and recap:** see sections 13 and 14.
- Pairs removed by strikes (section 8) leave at the round switch, after promotion and relegation; pairs below move up into the hole.
- Pairs leaving mid-season and empty spots: the organizer fills them from the waiting list; the rules engine suggests a placement.
- Pair count not divisible by 4: groups of 3 fill the gap (section 4).

## 11. Rating (Elo)
- Individual Elo, starting value based on self-assessed level (kezdő 1000, középhaladó 1200, haladó 1400, versenyző 1600; the same levels as the signup form).
- Pair rating = average of the two players.
- After a match, both players receive the same delta. K = 40 for a player's first 10 rated matches, 20 after (README decision log, 2026-10-05).
- Walkovers don't change Elo.
- Substitutes: Elo is computed from the players who actually played. The substitute's rating changes, the absent player's doesn't.

## 12. League configuration (per league, for multi-city)
Group size, phase length in weeks, phases per season (4), catch-up week on or off, deadline day, slot rules (minimum number of slots and days, time window, lead time), match format, scoring system, walkover rules, list of venues, number of fast-calibration switches (section 10), season prizes and sponsors per division.

## 13. Notifications (in Hungarian; README decision log, 2026-10-05)
Channels: email, and web push for players who opt in (PWA). No player gets more than one non-urgent email a day.

**Instant** (email and push), only when someone has to act soon or the groups change:
- New phase (Monday morning after the deadline): your group, opponents and the deadline.
- A proposal arrived, or an agreed time is waiting for confirmation.
- A result is waiting for confirmation.
- The match is tomorrow (the evening before an accepted slot).
- A 3rd strike: the pair leaves at the end of the phase.
- End of a phase, with your new group.
- End of a season: a recap per player (matches played and won, set and game difference, Elo at the start and end of the season, their group and division in each phase, a division or group win) with a "Nevezünk újra" button for the pair.

**Szervezők and Admins** (in the app and by push, no email):
- A new interest signup in their city (Admins: any city). City, pair or solo, level and the running counts only; no names or contact details.

**Daily digest** (one email in the morning, only on days with something in it; push gets the same items one by one):
- A slot was accepted, a time was cancelled, a result was confirmed.
- Reminder to both pairs if neither has proposed slots 2 days into the match's scheduled week.
- Reminder at the end of the scheduled week if the match is still unplayed ("pótoljátok a kör végéig").
- Reminder 3 days before the deadline if the match is still unscheduled.
- A 1st or 2nd strike, with the count (the 2nd is the warning).
- Reminder 2 days before the registration window closes, to pairs that haven't re-entered.

**Rules for all notifications:**
- Every notification has a one-tap action link (accept, confirm, record a time) and a shareable link ("küldd el a párodnak / ellenfélnek").
- The home screen shows the same open items as a "Teendők" list.
- Every notification is also kept in the app's notification list (`/notifications`): unread ones first, opening one marks it read. Each kind can be switched off on the profile page.
- Web push: offered after the first login ("Kérsz értesítést?"), opt-in, can be turned off. On iPhone it needs iOS 16.4+ and the site added to the home screen; the app explains this. Push never replaces email for instant items.

## 14. Public pages
- League home: groups, standings, matches this week. The ladder is one list with three colored division bands (Bronz, Réz, Rookie) and a header at each border. In the last phase, each group card shows what is at stake: "Divízió döntő" with the prize and its sponsor on a division's top group, the group-winner prize on the others; earlier phases show a hint instead. A "Hogyan működik?" explainer (3 short points and a picture of the bands) is linked from every badge.
- Pair home screen: one line with the division, the group and the distance to the division's top group ("Réz divízió, 8. csoport: még 2 feljutás a divízió éléig, 3 kör van hátra"); a note when the pair changes division at a round switch.
- Pair and player profiles: results and Elo history (no contact details).
- Season archive: every finished season's groups and standings for each phase (e.g. `/seasons/<slug>`), linked from pair profiles. A per-season recap block on profiles comes later.
- Rules page (`szabalyzat.md`).
- Privacy page ("Adatkezelési tájékoztató", section 17), linked from the footer and from every consent checkbox.

## 15. Out of MVP scope
Payment, court booking integration, chat, mobile app, multi-language support, social auto-posting (phase 2), Facebook login, native mobile app push, a "keresek párt" list.

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
  - Phone number: only the current round's opponents see it (section 3).
- **Where it is stored:** Cloudflare (D1 database with EU location, backups in R2). Processors to list: Cloudflare (hosting, database) and Resend (email).
- **Retention:**
  - Interest list: deleted after the first season starts, unless the person registers.
  - Accounts: kept until deletion, then anonymized (section 3).
- **Your rights:** access, correction, deletion and withdrawing consent, by emailing the contact address.
- **Solo signups:** the league's organizer sees their name, level, home club and note (no email) and may pair two of them; both then get one email with the other's name, level and email (2026-10-05).
- **Partner's data:** when someone signs up a pair, they enter their partner's name and email. We email the partner once, so they know about it and can ask for deletion, and they get the registration invite (section 3). Nothing else is sent to them until they register themselves. Until then, the player who registered sees only the partner's name from the signup on "Párom", never the email.

## 18. MVP plan and calendar (decided 2026-10-03)
Dates are Europe/Budapest.

| Milestone | Date | Must work |
|---|---|---|
| Registration opens | Mon 2 Nov 2026 | Accounts (Google and email code), roles, invites to the interest list, pairs, season with registration window, season entry and approval, venues, first-phase seeding |
| Round 1 starts | Mon 9 Nov 2026 | Publishing groups, my matches, scheduling (including recording an agreed time), results and confirmation, disputes, public standings, emails and reminders, daily backup |
| First round switch | Mon 30 Nov 2026 | Unplayed-match resolution, no-show reports, withdrawal, round switch draft and publish, promotion and relegation, Elo, public profiles, substitutes, strikes, web push and the daily digest, account deletion |
| Season end | Thu 31 Dec 2026 | 4-phase seasons, re-entry ("Nevezünk újra", organizer re-entry by hand), carrying approvals into the next season, season switch draft (carry-over, compaction, re-formed pairs as late joiners), season archive page, season recap email and re-entry reminder |

First season: registration 2–5 Nov (closes Thu 5 Nov 23:59), phase 1 runs 9–29 Nov, phase 2 30 Nov – 20 Dec (deadline may move to 23 Dec if matches are still open), break 21 Dec – 3 Jan, phase 3 4–24 Jan, phase 4 25 Jan – 14 Feb 2027. Season 2 starts after a 1–2 week gap. The first season is a warm-up. Until substitutes are built, the organizer handles them by hand.

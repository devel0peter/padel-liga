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
- Player status on the admin tables (README decision log, 2026-10-31, D56): "Felhasználók", "Jelentkezők", "Párkeresők" and "Párok" show, per player, whether they have an account and finished the first-login page, a missing level or phone number (never the number itself), their active pair in the league and its entry in the league's current or next season (or "Nem nevezett" while there is one). Only the Admin sees each account's last login (the time of its newest session, recorded at every login).
- "Hol tartanak" on "Jelentkezők" (README decision log, 2026-11-02, D57): each person on the interest list is at one stage: not invited, invited without an account, registration not finished, registered without a pair, paired but not entered, entered (or: paired while the league has no season, no league in the city, withdrawn). The page shows the number of people per stage under the other filters, and each number filters the list to the signups with someone at that stage. With this filter, a broadcast goes to the people at that stage (a pair signup's partner only once they registered themselves, never to withdrawn signups), and the CSV export has the signups shown (README decision log, 2026-11-02, D58). The admin searches ignore case and accents.

## 3. Authentication
- **No passwords** (2026-10-04): log in with Google, or with a one-time 6-digit code sent by email (valid 10 minutes, at most 5 tries, single use). Nothing to hash, reset or leak.
- Sessions last 90 days and are extended while used; platform admin sessions 12 hours. Logout, and logout on every device.
- Anyone can create an account, invited or not (README decision log, 2026-10-28, #113; replaces invite-only until 2 Nov): the first login of a new address, with Google or the emailed code, creates it. The bot check on sending a code and the code limits stay; a new address gets no code when it bounced or complained before, and codes to new, uninvited addresses may use at most a quarter of the daily email limit, 1,250 with the relay (README decision log, D49, D51). The code step looks the same either way, also after a wrong code or a resend (an address that gets no email still gets a code nobody knows, under the same limits), and its "Nem jött meg?" line names the other ways in for everyone: the spam folder, another address, Google login (when set up) and the contact address as a `mailto:` link (README decision log, D65, #123). A new player goes through the same first-login page. A player without a signup starts without a pair; Kezdőlap and Párom give them their own pair link (section 4), and Párom says that the organizer finds a partner for those with nobody, with the contact address; a Szervező pairs them on the Párok page (section 4). Registration has its own page, `/register` ("Regisztráció"): the login flow with its own words (Google button "Regisztráció Google-lel", code step "Tovább"), linked from the landing page, the registration invite and the pair link; `/login` and `/register` link to each other (README decision log, 2026-10-31).
- First login asks for a name and privacy consent.
- First login from the interest list (#130; README decision log, 2026-10-29, D52): the first-login page of an address with a signup already holds that signup's name (only when the account has no name yet, e.g. a code login; a Google login keeps the Google name) and level, both editable, and says so in one line ("A jelentkezésedből már megvan a neved és a szinted. Csak a telefonszámod kell, és hogy férfi vagy nő vagy."). The newest signup naming the address wins (as the signer its own name, as the partner of a pair signup the name the signer gave). A player whose pair signup names a partner without an address gets the optional partner address field (#96) on the same page; it is saved with "Kész", after the consent is ticked, and invites the partner as the box does. Nothing is created for a signup before its own first login: the account comes from the player's own login and the consent stays the player's own tick.
- Facebook login: after the MVP (Meta business verification and app review take weeks).
- Onboarding from the interest list: when registration opens, everyone on the list gets one invite email each with a registration link, their email pre-filled: both addresses of a pair signup, and every solo. It opens with thanks for signing up early, when and where the league starts and the link ("Köszi, hogy előzetesen jelentkeztél a Padelpárbajra! A liga november 9-én indul (Győr), a nevezés november 6-ig tart. Regisztrálni és nevezni itt tudsz:"), and says their name and level are already there, so only the phone number is needed (README decision log, 2026-10-29, #131, D53). The dates are round 1's start and the last registration day of the current season of the city's league, and the city is its name, all from the data; the registration day is left out once registration has closed, and the whole date sentence without such a season or once round 1 has started. Only this email carries the early-signup thanks. A solo still waiting for a partner gets its own short text ("Még keresünk neked párt, addig regisztrálj."); the signer of a pair signup without the partner's email gets one extra sentence asking them to add it when they log in (on the first-login page, #130). Like every email, they go out as soon as the Admin starts the invite on "Jelentkezők", within the daily limit (#112). For the first season everyone starts with the partner from the signup: the pair forms by itself once both have registered (section 4; README decision log, 2026-10-24, #89, and 2026-10-25, #96). If one of two paired solos is marked "Visszalépett" (withdrawn), the pairing is undone and the other waits for a partner again; the withdrawn signup gets no pair and no invite or pair introduction, and any of these mails still unsent are deleted; setting the status back re-pairs nobody (README decision log, 2026-10-28, #114).
- Partner without an email (#96): a logged-in player whose pair signup names a partner without an address sees a box on the home page and Párom, and a field on the first-login page (#130) ("A párodnak (<név>) nincs e-mail-címe nálunk. Add meg, és ő is kap meghívót."). Saving fills the signup's partner address, as if it had been on the form, and sends the partner's registration invite right away (like every invite); no token, no confirmation. Refused: the player's own address, or one that already has an active pair in that league. The partner's first-login page shows "A párod: <név>." with "Nem ő? Írj nekünk: <contact address>"; the organizer fixes such cases on the Párok page (section 4).
- Same email = same account, whichever way they log in. A Google login links to an existing account only if Google reports the email as verified.
- Profile:
  - Required: name, email.
  - Required: self-assessed level (kezdő / középhaladó / haladó / versenyző; asked at first login, prefilled from the interest signup with the same email; accounts that predate it are prompted on the home page, and the level is required to apply for a season).
  - Required: phone number (Hungarian numbers only, stored as +36…, shown as `+36 30 123 4567`; visible only to opponents in the current round, never public; asked at first login, not on the interest form; it can be changed but not removed on the profile page; README decision log, 2026-10-28). Name, level and phone are editable on the profile page.
  - Required: sex, "Férfi" or "Nő" only (#133; README decision log, 2026-10-29, D54): what the player picks, never inferred from a name or prefilled; asked at first login next to the phone number and editable (not removable) on the profile page. An account from before it was asked is sent once, on its next app page, to a one-question page ("Még egy kérdés") and then on to where it was going. Never public and never shown to other players; it lets the organizer email a group of players (e.g. a women-only event; filtering broadcasts by it comes later).
- GDPR:
  - Privacy notice (section 17) and consent at registration.
  - Account deletion with anonymization: match history stays, the name becomes "Törölt játékos".

## 4. Domain model (simplified)
- **City (tenant):** slug and name, managed by the platform admin at `/admin/cities` (2026-10-05). Signups, clubs, leagues and organizers belong to a city. A city marked "listed" is offered on the signup form and the landing page; only cities with an organizer should be listed (in the MVP, Győr alone). Adding a city files the earlier "Más város" signups that typed its name under it. The signup form also offers "Más város" with a free-text city name, to measure demand where there is no league yet (a typed name matching a supported city is filed under that city). User-facing text never hard-codes a city. On the landing page a city with a league shows the league's state (registration, running round, next season) and the point where a new pair can join, and leads to registration instead of the interest form (2026-10-28, #83). The league cities' state and register button sit in the hero, above the fold; the form at the bottom is only for cities without a league: name, email, typed city, level, an optional message and "Szívesen szerveznék ligát" (`wants_to_organize`). Typing a league city there shows the way to registration instead, and the server refuses such a signup (2026-10-29).
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
- **Pair:** 2 players. A pair is a separate entity; a player can be in at most one active pair per league. Pairs are fixed within a phase: forming a new pair or changing partner is only possible between phases. Players start with the partner they signed up with: a pair named on the interest signup (section 3) forms by itself when the second of the two finishes registering, if neither player's own newer signup names someone else or nobody, and unless either is already in an active pair in that league. It forms only once: after a dissolve it doesn't come back. Or a player invites one with their **pair link** (README decision log, 2026-10-31): every player without an active pair in a league has one personal link for it (`/pair/join/<token>`), shown on Kezdőlap and Párom ("Hívd meg a párodat", with "Link másolása" and the phone's share sheet), which they send themselves; no email. Whoever opens it sees the owner's name and the league (never an email or phone), registers or logs in (through the first-login page) and comes back to it; "Elfogadom" makes the pair (source "linkkel"), audited, while neither of the two is in an active pair of the league (checked again inside the insert). Refused: the owner's own link, a player already in a pair there, an owner who has a pair by now. The link stays the same, and works again once the owner has no pair. Every other change is an organizer task (README decision log, 2026-10-25, #97): on the league's "Párok" page the Szervező (or the Admin) creates a pair from two registered players without a pair in the league, dissolves a pair ("Felbontás"), or changes one player's partner ("Partner cseréje": dissolve and new pair in one step). Dissolving or changing is refused while the pair is in a published group whose phase hasn't reached its deadline. Dissolving withdraws the entries the pair hasn't played in yet. Every change is audited; no email is sent, the organizer tells the players. Players have no dissolve or partner change of their own.
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

- **"Párt keresek"** (README decision log, 2026-11-02, D59): while a registered player has no pair in a league, Párom and Kezdőlap show a switch to ask the organizer for a partner. It is on by default for someone whose solo signup is still waiting, or whose solo partner registered while the two have no pair, and off for everyone else. Párkeresők lists the registered players with it on and no pair ("Regisztráltak"). Two of them become an active pair at once, with an in-app message and no email. Solo signups whose person hasn't registered yet are paired as before ("Még nem regisztráltak").
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
5. Every action is timestamped and logged. This is the evidence for walkovers. The log is shown on the match page to both pairs; how the state follows from it, the slot rules' details and the page: README decision log, 2026-11-02 (D66, D68).
6. Either side can cancel an accepted or confirmed slot; this reopens the proposal process.
   - **Late cancellation (under 24 hours before the slot):** not an immediate walkover. The cancelling side must make the next proposal. If the match isn't played by the deadline, the cancelling side counts as the inactive side in section 8 (walkover for the other side), regardless of its earlier activity.

## 7. Recording results
- Format (league default, one format per league, no per-match variants; see section 12):
  - Best of 2 sets. Short sets: a set goes to 4 games (win by 2); at 4-4 a regular tie-break to 7 (win by 2).
  - Valid set scores: 4-0, 4-1, 4-2, 5-3 (4-3 plays on) and, after the tie-break, 5-4. Anything else, a third set, or a super tie-break at 2-0 is rejected with a Hungarian message (`packages/rules` `validateScore`).
  - At 1-1 in sets, a super tie-break to 10 (win by 2) replaces the third set.
  - Golden point: no advantage at deuce, one point decides; the receiving pair chooses which player receives.
  - For set and game difference the super tie-break counts as one set and as a 1-0 game (ITF convention).
- Court booking: 60 minutes is usually enough (Győr clubs only take 60-minute bookings).
- Court time runs out: the match is unfinished. The pairs note the score and finish it from there in a new slot before the deadline. Only the final result is recorded.
- One pair records the result, and the other confirms or disputes it.
- Not confirmed within 48 hours: the result is accepted automatically.
- A disputed result goes to the organizer, who decides.
- The page, corrections, the dispute's own version and the auto-accept run: README decision log, 2026-11-02 (D77).

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

Pairs still equal after every step (head-to-head undecided or unplayed, same set and game difference, same Elo) keep their seed order in the group (strongest first), so the order is always strict (README decision log, 2026-11-02, D61).
A withdrawn pair (section 4) is left out of the table with all of its matches; unplayed matches (section 8) give no points and count in neither difference.


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
Channels: the in-app list, email and web push (PWA). Every user chooses on the profile (Profil → Értesítések) whether notifications also come by email, by push, or both; both switches are on by default (README decision log, 2026-10-28, #115, D50). No player gets more than one non-urgent email a day.

Emails are sent from `hello@padelparbaj.hu` through Google Workspace's SMTP relay; what the relay refuses or can't take goes through Resend. Each email is marked sent or failed on its own. The league's own limit is 5,000 emails a day with the relay (100 without it, on Resend alone), sent in this order: login codes, personal emails, bulk mail (README decision log, 2026-10-28, #111; 5,000 since 2026-10-29, #127, D51). While the relay is not set up, "Kimenő levelek" says so in production.

Every email goes out by itself as soon as it is made, within the daily limit; what doesn't fit waits for the next day's limit, in the send order above. Nothing waits for an Admin. "Kimenő levelek" (`/admin/outbox`, Admin only) is the log: per kind, how many emails wait, went out and failed, with the newest failure's reason, never an address (README decision log, 2026-10-28, #112; replaces the held outbox of #88).

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
- The home screen shows the same open items as a "Teendők" list (README decision log, 2026-11-02, D67).
- Scheduling (D68): "a proposal arrived" and "an agreed time is waiting" are instant; "a slot was accepted", a confirmed agreed time and a declined one are daily-digest items, in the app and by push until the digest email exists (#31).
- Every notification is also kept in the app's notification list (`/notifications`), whatever the switches: unread ones first, opening one marks it read. Szervezők and Admins can switch off their own kinds (e.g. a new signup) on the profile page; a kind switched off is not stored or sent at all. Players have no per-kind switches, only the two channels.
- **Email switch:** off, no email goes to that account's address except login codes and signup confirmations: broadcasts, pair intros, registration invites and partner notices are skipped too (Peter, 2026-10-29). Addresses without an account get everything as before. A pair intro also appears in the app for whoever has an account.
- **Push switch:** off, no push goes to any of the account's devices. Turning it on asks this browser for permission and subscribes this device; other devices are switched on from themselves ("Bekapcsolom ezen az eszközön"). On iPhone it needs iOS 16.4+ and the site added to the home screen; the profile explains this. A player who switches email off gets instant items by push and in the app only.

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
  - Later: account data, the phone number, match history, ratings.
  - Notifications: the in-app list, the email and push choices, and each device's push subscription (the browser's push address; the push itself goes encrypted through the browser maker's push service: Google, Apple, Mozilla, Microsoft).
- **Why:** only to organize the league and send league emails. No marketing for third parties, and no selling of data.
- **Who sees what:**
  - Public: names, results, standings and ratings.
  - Never public: email and phone number.
  - Phone number: only the current round's opponents see it (section 3).
- **Where it is stored:** Cloudflare (D1 database with EU location, backups in R2). Processors to list: Cloudflare (hosting, database), Google (Google Workspace: the contact mailbox, and sending the league's emails through its SMTP relay, #111) and Resend (email, fallback when the relay can't send).
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
| Registration opens | Thu 29 Oct 2026 (was Mon 2 Nov; README decision log, 2026-10-29) | Accounts (Google and email code), roles, invites to the interest list, pairs, season with registration window, season entry and approval, venues, first-phase seeding |
| Round 1 starts | Mon 9 Nov 2026 | Publishing groups, my matches, scheduling (including recording an agreed time), results and confirmation, disputes, public standings, emails and reminders, daily backup |
| First round switch | Mon 30 Nov 2026 | Unplayed-match resolution, no-show reports, withdrawal, round switch draft and publish, promotion and relegation, Elo, public profiles, substitutes, strikes, web push and the daily digest, account deletion |
| Season end | Thu 31 Dec 2026 | 4-phase seasons, re-entry ("Nevezünk újra", organizer re-entry by hand), carrying approvals into the next season, season switch draft (carry-over, compaction, re-formed pairs as late joiners), season archive page, season recap email and re-entry reminder |

First season: registration 29 Oct – 6 Nov (closes Fri 6 Nov 23:59; Peter, 2026-10-29), phase 1 runs 9–29 Nov, phase 2 30 Nov – 20 Dec (deadline may move to 23 Dec if matches are still open), break 21 Dec – 3 Jan, phase 3 4–24 Jan, phase 4 25 Jan – 14 Feb 2027. Season 2 starts after a 1–2 week gap. The first season is a warm-up. Until substitutes are built, the organizer handles them by hand.

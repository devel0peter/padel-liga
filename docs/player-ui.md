# Player UI: requirements

What the player-facing pages must do, compiled on 2026-11-07 from the spec, the rules, the decision log and Peter's review of the running round in the local seed (D127). The admin pages come later. The redesign that follows this document is D133; Peter's second review (D134–D136) amended it the same day.

Sources: [spec.md](spec.md) sections 3–9, 13, 14, 16, 17; [szabalyzat.md](szabalyzat.md); [decisions.md](decisions.md) D67, D68, D74, D77, D80, D85, D103a, D106, D108, D109, D112, D121, D133–D136.

## 1. Constraints that every page keeps

| # | Requirement | Source |
|---|---|---|
| C1 | Everything on screen is Hungarian, informal ("tegező") and short. Dates as "nov. 10., kedd 19:00", 24-hour time, Budapest time, decimal comma. | CLAUDE.md, spec 16 |
| C2 | Mobile first: most visits come from a phone link. At 390 px nothing scrolls sideways and nothing is cut off; tap targets are at least 40 px high. | spec 16, #146, `27-table-fit` |
| C3 | Desktop uses the width: no single narrow column with an empty right half. | Peter, 2026-11-07 |
| C4 | Phone numbers and email addresses: only the current phase's opponents, while the match is still to be played (tap to call, `mailto:`), and the active partner (Profil's Párod section, D141; with the opponents in the match's "Írj mindenkinek" links, D147). Never on a public page. | spec 3, D67, D121, D135, D147 |
| C5 | Group tables count final results only (confirmed, auto-accepted, organizer or deadline decision). A result waiting for confirmation or disputed never counts. One table computation (`groupTable`) for every page. | D80, D85 |
| C6 | Results read the same everywhere: pair A first, "4:2, 2:4, szuper tie-break 10:7"; both lose as "Mindkét pár vereséget kap (0:6, 0:6)", the score in the round's set format (0:4, 0:4 in Győr's round 1, D173). | D85 |
| C7 | Nothing about the league is public: tables, results and profiles are for logged-in players only (the league page sits in the app shell). The league page shows names, tables and results only; no rating on it. Public stay the landing page, rules, privacy, login and register. | spec 14, D112, D134 |
| C8 | Logged-in pages sit in the app shell and use `AppPage` (one header, no own `<h1>`); shadcn/ui components first. | CLAUDE.md |
| C9 | Every player step on a match stays reachable whatever the state: propose, counter-propose, agreed time, accept, confirm/decline, venue, cancel, record/correct/confirm/dispute a result, marking a player who doesn't play (also on the result form), no-show report. A redesign may fold a form away, never remove it. | spec 6–8, D68, D74, D77, D108, D175 |
| C10 | One look for every block: the building blocks of `docs/ui-guidelines.md` (direction A); colour carries status (green, amber, blue, red, the yellow primary action), never decoration. A page shows what the player needs now; the rest is one tap away (a fold, a tab or another page). | Peter, 2026-11-07 (D136); 2026-11-27 (D181) |

## 2. Group table

| # | Requirement | Source |
|---|---|---|
| T1 | Columns: place, pair, played (M), wins (Gy), losses (V), sets won:lost (Szett), games won:lost (Játék), points (P). Ratios, not only differences, so a player can check the tiebreak by eye. Under 640 px Játék is left out, so the names keep room (T6); the league page on a wider screen has it. | Peter, 2026-11-07; spec 9 |
| T2 | The places that move at the end of the round are marked: 1st moves up (not in group 1), last moves down (not in the last group; in a group of 3 the 3rd). A legend says what the marks mean. | spec 10; Peter, 2026-11-07 |
| T3 | Before any final result the order is only the seeding: no place numbers and no up/down marks, so nobody reads the seed as a ranking. | D85 |
| T4 | The player's own pair is in bold on the ball-yellow tint, its place in yellow (the word "ti" stays for screen readers), on Kezdőlap, the Tabella, where their group is outlined too, and the Ranglista (a small "TE"/"TI" tag there). | D67, D136, D143, D183 |
| T5 | Column headings are explained (title and a legend line), since M, Gy, V, P are abbreviations. | Peter, 2026-11-07 |
| T6 | At 390 px the table fits without sideways scroll; pair names wrap onto a second line rather than squeezing the numbers. | C2 |
| T7 | A pair withdrawn mid-phase is out of the table, listed under it as "Visszalépett". | spec 9, #34 |

## 3. Fixture list (a group's matches)

| # | Requirement | Source |
|---|---|---|
| F0 | On the Tabella each group's matches open from the "A csoport meccsei (N)" row under its table; on wider screens the own group's are open there already. A waiting result is a pill ("Megerősítésre vár", "Vitatott"), a played one its sets ("4:2 · 4:1"). Kezdőlap shows only the pair's own matches (D184). | Peter, 2026-11-07 (D136); 2026-11-08 (D138, D140, D143) |
| F1 | Every match of the group, grouped by week (1.–3. hét with the dates), like a fixture list: pair A, the score or the time in the middle, pair B. | Peter, 2026-11-07; spec 5 |
| F2 | A played match shows its sets and who won (the winner in bold). | Peter, 2026-11-07 |
| F3 | A match without a final result shows its state: time and venue once fixed, "Egyeztetés alatt", "Eredmény megerősítésre vár" or "Vitatott eredmény". No match disappears from the list because of its state. | Peter, 2026-11-07; D80 |
| F4 | A group of 3 shows who rests that week. | spec 5 |
| F5 | The current week is marked. | spec 5 (play in the scheduled week is nudged) |

## 4. Kezdőlap

| # | Requirement | Source |
|---|---|---|
| H1 | The title greets the player ("Szia, Anna!", spec 4), with the season and the league above it. | D182, D184, mockup P01 |
| H2 | The round's card: round, week, days left, deadline, a bar of the time gone, and how many of the pair's matches are done. | D184 |
| H3 | "Rád vár · N" first, only when there is one: a card per step waiting on the player. The opponents' result to confirm is answered on the card ("Megerősítem", the only yellow button; "Nem így volt" opens the match page); every other step is a card that opens its match page. | D67, spec 13, D184 |
| H4 | The group's standing: the pair's place as a big number with its points, division and group, the table in short (place, team, sets, points; the own row highlighted, promotion and relegation places named), a link to the Tabella. Before any final result no places show (D85). | D67, D85, D184 |
| H5 | "Meccseid az N. körben": the pair's matches of the round, each with its state as a coloured pill, the week, the opponents, and the score or when it is due; each opens its match page. | D184 |
| H6 | Not on Kezdőlap: the opponents' contact data and "Írj mindenkinek" (match page), the whole group's matches (Tabella), the season calendar (Ligáim). No email address or phone number on the page. | D184 |
| H7 | Wider screens: to-dos and matches left, standing and whether the pair plays on in the next round (a link to Ligáim) right. | D184, mockup P01 |
| H8 | Below the main content, at most one "Tipp" card about a feature the player may not know, first the push tip ("Kapj értesítést a telefonodra", "Bekapcsolom", "Most nem"): never a pop-up, never on another page. | D160, #262, spec 13 |
| H9 | Before the groups are out, or for a season the player has no group in: the season card (dates, entry, strikes), pair link, "Párt keresek", as before. The player's strikes show under "Rád vár" once the group runs. | D55, D59, #23, #294 |

## 5. Match page

| # | Requirement | Source |
|---|---|---|
| M1 | A summary at the top: the state in words, when and where, the score once there is one (per set, winner marked), our pair and theirs, the opponents' call buttons with "Írj mindenkinek" under them (one SMS or email to the partner and both opponents, or their numbers copied; the app sends nothing; not once the result is final; while the match is being scheduled it moves to "Írjatok egymásnak", M3), the calendar buttons once fixed. A tap on the SMS or e-mail button is logged as an attempt to schedule (D148). | D68, D106, D147, D148; Peter, 2026-11-07 |
| M2 | One main action at a time, chosen by the state; everything else folded behind a one-line opener. | Peter, 2026-11-07 |
| M3 | No fixed time yet and nothing of theirs to answer: first "Írjatok egymásnak" (the main block: "Beszéljétek meg SMS-ben vagy e-mailben, aztán rögzítsétek itt az időpontot." and the Írj mindenkinek buttons), then "Megbeszéltétek? Rögzítsétek az időpontot" open (day chips and hour chips 7:00–22:00, optional venue), then the proposal form folded ("Vagy adjátok meg, mikor értek rá, és a másik pár választ": day chips from today to the deadline, then quick ranges "Délelőtt 8–12", "Délután 14–18", "Este 18–22", cut to the hours left, or Ettől/Eddig whole hours and "Hozzáadom"; the added ranges listed with a remove button; the rules' own messages before sending); the short guide folded. No native date or time field. | D68, D144, D148 |
| M4 | Their proposal open: their open ranges by day, each with its whole-hour starts as chips ("Választható kezdések"), and "Elfogadom", the main action; "Írjatok egymásnak" under it; an agreed time and a counter-proposal folded ("Egyik sem jó?"). | D68, D144, D148 |
| M5 | Their agreed time open: "… Fix lesz <időpont>-kor, ha nem jelzitek, hogy nem így beszéltétek." with "Megerősítem" / "Nem így beszéltük"; after that moment it is fixed by itself. | spec 6.3, D148 |
| M6 | Our proposal or agreed time open: what we sent and that we wait (an agreed time: when it becomes fixed); with our proposal the agreed-time recorder stays open as in M3, with our agreed time it is folded; a new proposal folded. | D68, D148 |
| M7 | Fixed and not started yet: venue (open while none is recorded), calendar, cancel (folded, with the late-cancel warning). The result form is folded ("Már lejátszottátok?"). | D74, D106 |
| M8 | Fixed and started, or played without the app: recording the result is the main action. While the match has no club, the result form (main or folded) asks "Hol játszottatok?" (required club select) and the optional court, above the button; with a known club it asks nothing more. | D77, D146 |
| M9 | Their result waiting: "Megerősítem" is the main action with the score and the auto-accept time; the dispute form opens from "Nem így volt?". | D77 |
| M10 | Our result waiting, disputed, final: shown as it stands, with who decided. | D77, D78 |
| M11 | Substitute and no-show: folded unless something is already pending or decided. A player marked as not playing shows to all four in "Helyettes", and next to the result to confirm. | D108, D175 |
| M12 | The log stays visible to both pairs, compact. | spec 6.5 |

## 6. Profile

| # | Requirement | Source |
|---|---|---|
| P1 | Two tabs: "Játékosprofil" (default) and "Beállításaim" (`?tab=settings`); links to the settings (level, notifications) open that tab. | Peter, 2026-11-07 (D136) |
| P2 | The rating is "Élő-pont" wherever a player reads it, with the one-tap explanation. | Peter, 2026-11-07 (D136) |
| P3 | A summary on every player and pair profile: Élő-pont (a pair's: its players' average), seasons and rounds played in, matches, wins, losses. Final results only (D80). | Peter, 2026-11-07 (D136) |
| P4 | Játékosprofil shows what other players see on `/players/<id>`, the same component. The player's pairs are links to their pages ("A pár oldala"). | D112, D136 |
| P5 | "Párod" first on Játékosprofil, above the summary: what Párom showed, one card per league (named only when there are several). `/pair` leads to `/profile#parod`, query kept. | Peter, 2026-11-08 (D141) |
| P6 | "Korábbi párjaid" under Párod, only when there is one: former partner (pair page link; "Törölt játékos" without one), league, seasons and rounds, "Felbontva" or "Partnercsere" and the day, newest first. No contact data. | Peter, 2026-11-08 (D142) |

## 7. League page and navigation

| # | Requirement | Source |
|---|---|---|
| L1 | The league page ("Tabella", in the app shell, D134) uses the same table (section 2) and fixture list (section 3) per group. Every group is open, under its division's name with the division's dot; two columns of divisions on wide screens; the legend is one line at the bottom. On a phone a "Csoportok / Ranglista" switch at the top leads to the Ranglista. | spec 14, D85, D143, D183 |
| L2 | At 390 px pair names don't break into four lines; at desktop width the table doesn't spread its numbers across the page. | Peter, 2026-11-07 |
| L3 | A Ranglista: players and pairs by Élő-pont as pill tabs, the viewer marked, each name linking its profile; on a phone the Tabella's second view, on wider screens its own sidebar item. The first 16 rows, then "Még N játékos". Wider screens add each row's pair and division, an "Élő-pontod" card (place and last change) and "Mi az Élő-pont?". Ties share a place until #345. | Peter, 2026-11-07 (D137); 2026-11-27 (D183, mockup P05) |
| L4 | "Hogyan működik a létra?" is behind a "?" at the end of the Tabella's legend line, in a tooltip (hover, tap or focus). | Peter, 2026-11-08 (D138) |
| L5 | "Ligáim" (`/leagues`): one card per league of the player (D128), newest season first; one league's card alone at `/leagues/<league>`, and with one league the page shows it without a list. The card's sections: the season's round with its dates and deadline (between rounds, when the next one starts); the partner by name, or "Nincs párod" with "Hívd meg a párodat"; the pair's group and place ("A 3. csoportban vagytok, most 2. helyen"), the round it starts in ("A 2. körben kezdtek (dec. 7.)") or "Nem neveztetek" with the entry's existing button; the league in numbers (pairs, groups, played out of all matches of the Tabella's round, the Tabella's own numbers); the player's season (matches, wins, Élő-pont); Tabella and Szabályzat. No email or phone. In no league: Kezdőlap's "Melyik ligában játszol?" card. | Peter, 2026-11-24 (D174, #394) |
| L6 | "Párkereső" (#398): a section of the Ligáim card, right after "Párod", at `/leagues/<league>#parkereso`. A player without a pair sees the league's seekers, newest first (name, level, Élő-pont once rated, "3 napja keres"); phone (call, SMS) and email (write) only when the viewer is a seeker too, else "Bekapcsolom a párkeresést". Under the list the viewer's switch (seekers) and their own pair link ("Hívd meg a párodat"). With a pair: "Neked már van párod." Linked from "Párod" on the card ("vagy nézd meg a Párkeresőt") and from the "Párt keresek" box on Kezdőlap and Párod ("Nézd meg a Párkeresőt"). Contact rows are 40 px high for a thumb; no sideways scroll at 390 px. | Peter, 2026-11-24 (D177, #398) |
| L7 | Ligáim's card has a "Következő kör" section while the pair plays a round that isn't the season's last: "Benne vagytok a 2. körben (dec. 7-től). Ha nem folytatnád, jelezd dec. 6., 23:59-ig." with "Nem folytatom" (a confirmation first); once opted out, the line says so to both players and only the one who opted out sees "Mégis folytatom", until the deadline; after it, "Az 1. kör után nem folytatjátok a szezont." | Peter, 2026-11-24 (D176, #395) |
| N1 | On a phone the player's own sections are one tap away (bottom bar: Kezdőlap, Tabella, Ligáim, Értesítések with the unread count, Profil; the pair is a section of Profil since D141); the sidebar stays for the organizer and admin sections, and its first items are Kezdőlap, Tabella, Ranglista, Ligáim, Értesítések. | Peter, 2026-11-07, 2026-11-24 (D174); spec 16 |

## 8. Not in this round

- The admin pages (Áttekintés, Meccsek as a fixture list, groups one under the other): next round, reusing sections 2 and 3.
- Pair statistics in Párod beyond the link to the pair's profile.
- The Értesítések list itself (empty in the seed because the seed writes no notices).

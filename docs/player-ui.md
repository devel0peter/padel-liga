# Player UI: requirements

What the player-facing pages must do, compiled on 2026-11-07 from the spec, the rules, the decision log and Peter's review of the running round in the local seed (D127). The admin pages come later. The redesign that follows this document is D133; Peter's second review (D134–D136) amended it the same day.

Sources: [spec.md](spec.md) sections 3–9, 13, 14, 16, 17; [szabalyzat.md](szabalyzat.md); [decisions.md](decisions.md) D67, D68, D74, D77, D80, D85, D103a, D106, D108, D109, D112, D121, D133–D136.

## 1. Constraints that every page keeps

| # | Requirement | Source |
|---|---|---|
| C1 | Everything on screen is Hungarian, informal ("tegező") and short. Dates as "nov. 10., kedd 19:00", 24-hour time, Budapest time, decimal comma. | CLAUDE.md, spec 16 |
| C2 | Mobile first: most visits come from a phone link. At 390 px nothing scrolls sideways and nothing is cut off; tap targets are at least 40 px high. | spec 16, #146, `27-table-fit` |
| C3 | Desktop uses the width: no single narrow column with an empty right half. | Peter, 2026-11-07 |
| C4 | Phone numbers and email addresses: only the current phase's opponents, while the match is still to be played (tap to call, `mailto:`), and the active partner (Profil's Párod section, D141). Never on a public page. | spec 3, D67, D121, D135 |
| C5 | Group tables count final results only (confirmed, auto-accepted, organizer or deadline decision). A result waiting for confirmation or disputed never counts. One table computation (`groupTable`) for every page. | D80, D85 |
| C6 | Results read the same everywhere: pair A first, "4:2, 2:4, szuper tie-break 10:7"; both lose as "Mindkét pár vereséget kap (0:4, 0:4)". | D85 |
| C7 | Nothing about the league is public: tables, results and profiles are for logged-in players only (the league page sits in the app shell). The league page shows names, tables and results only; no rating on it. Public stay the landing page, rules, privacy, login and register. | spec 14, D112, D134 |
| C8 | Logged-in pages sit in the app shell and use `AppPage` (one header, no own `<h1>`); shadcn/ui components first. | CLAUDE.md |
| C9 | Every player step on a match stays reachable whatever the state: propose, counter-propose, agreed time, accept, confirm/decline, venue, cancel, record/correct/confirm/dispute a result, substitute, no-show report. A redesign may fold a form away, never remove it. | spec 6–8, D68, D74, D77, D108, D109 |
| C10 | One look for every block: a card with one heading; no coloured boxes, glows or badges for decoration. A page shows what the player needs now; the rest is one tap away (a fold, a tab or another page). | Peter, 2026-11-07 (D136) |

## 2. Group table

| # | Requirement | Source |
|---|---|---|
| T1 | Columns: place, pair, played (M), wins (Gy), losses (V), sets won:lost (Szett), games won:lost (Játék), points (P). Ratios, not only differences, so a player can check the tiebreak by eye. Under 640 px Játék is left out, so the names keep room (T6); the league page on a wider screen has it. | Peter, 2026-11-07; spec 9 |
| T2 | The places that move at the end of the round are marked: 1st moves up (not in group 1), last moves down (not in the last group; in a group of 3 the 3rd). A legend says what the marks mean. | spec 10; Peter, 2026-11-07 |
| T3 | Before any final result the order is only the seeding: no place numbers and no up/down marks, so nobody reads the seed as a ranking. | D85 |
| T4 | The player's own pair is in bold, with no "ti" label and no row colour (the word stays for screen readers), on Kezdőlap, the Tabella, where their group is marked too, and the Ranglista ("te"/"ti" likewise). | D67, D136, D143 |
| T5 | Column headings are explained (title and a legend line), since M, Gy, V, P are abbreviations. | Peter, 2026-11-07 |
| T6 | At 390 px the table fits without sideways scroll; pair names wrap onto a second line rather than squeezing the numbers. | C2 |
| T7 | A pair withdrawn mid-phase is out of the table, listed under it as "Visszalépett". | spec 9, #34 |

## 3. Fixture list (a group's matches)

| # | Requirement | Source |
|---|---|---|
| F0 | On the Tabella the fixture list opens in a side panel from each group's card ("A csoport meccsei"), so the page under it doesn't move. Kezdőlap shows it under the group's table, the pair's own rows a link. | Peter, 2026-11-07 (D136); 2026-11-08 (D138, D140) |
| F1 | Every match of the group, grouped by week (1.–3. hét with the dates), like a fixture list: pair A, the score or the time in the middle, pair B. | Peter, 2026-11-07; spec 5 |
| F2 | A played match shows its sets and who won (the winner in bold). | Peter, 2026-11-07 |
| F3 | A match without a final result shows its state: time and venue once fixed, "Egyeztetés alatt", "Eredmény megerősítésre vár" or "Vitatott eredmény". No match disappears from the list because of its state. | Peter, 2026-11-07; D80 |
| F4 | A group of 3 shows who rests that week. | spec 5 |
| F5 | The current week is marked. | spec 5 (play in the scheduled week is nudged) |

## 4. Kezdőlap

| # | Requirement | Source |
|---|---|---|
| H1 | "Teendők" first, only when there is one: every step waiting on the player, each a link, with its deadline where there is one (auto-accept time, phase deadline). | D67, spec 13, D136 |
| H2 | "Következő meccsetek": only the next match to play (the first without a final result): opponents, state, time and venue once fixed, the opponents' phone and email, and the way to its page; gone once every match is final. | D67, D136, D140 |
| H3 | The group: division and group, round and deadline, the table (section 2), a link to the Tabella, and under the table every match of the group with its result (section 3), the pair's own rows a link. | D67, D85, D136, D138, D140 |
| H4 | Where the pair stands on the ladder: "Réz divízió, 2. csoport · még 1 feljutás a divízió éléig, 3 kör van hátra". | spec 14 |
| H5 | A link to the whole league (every group). | Peter, 2026-11-07 |
| H6 | The season card opens the left column as the season's summary: under its title the round being played and its deadline; its rounds listed with their dates, the round being played highlighted; entry button and strikes count. | D103a, #23, D136, D139, D143 |
| H7 | Before the groups are out: pair link, "Párt keresek", entry, as today. | D55, D59, #23 |

## 5. Match page

| # | Requirement | Source |
|---|---|---|
| M1 | A summary at the top: the state in words, when and where, the score once there is one (per set, winner marked), our pair and theirs, the opponents' call buttons, the calendar buttons once fixed. | D68, D106; Peter, 2026-11-07 |
| M2 | One main action at a time, chosen by the state; everything else folded behind a one-line opener. | Peter, 2026-11-07 |
| M3 | To schedule: the proposal form is the main action; "Máshol már megbeszéltétek?" (agreed time) folded; the short guide folded. | D68 |
| M4 | Their proposal open: their slots as large tappable choices and "Elfogadom"; a counter-proposal and an agreed time folded ("Egyik sem jó?"). | D68 |
| M5 | Their agreed time open: "Megerősítem" / "Nem így beszéltük". | spec 6.3 |
| M6 | Our proposal or agreed time open: what we sent and that we wait; a new proposal folded. | D68 |
| M7 | Fixed and not started yet: venue (open while none is recorded), calendar, cancel (folded, with the late-cancel warning). The result form is folded ("Már lejátszottátok?"). | D74, D106 |
| M8 | Fixed and started, or played without the app: recording the result is the main action. | D77 |
| M9 | Their result waiting: "Megerősítem" is the main action with the score and the auto-accept time; the dispute form opens from "Nem így volt?". | D77 |
| M10 | Our result waiting, disputed, final: shown as it stands, with who decided. | D77, D78 |
| M11 | Substitute and no-show: folded unless something is already pending or decided. | D108, D109 |
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
| L1 | The league page ("Tabella", in the app shell, D134) uses the same table (section 2) and fixture list (section 3) per group. The groups sit one under the other in a list that scrolls on its own while the page keeps the screen's height; the group in the middle is full size, those above and below shrink and fade with their distance; on load the viewer's group is in the middle. | spec 14, D85, D143 |
| L2 | At 390 px pair names don't break into four lines; at desktop width the table doesn't spread its numbers across the page. | Peter, 2026-11-07 |
| L3 | A Ranglista: players and pairs by Élő-pont in two tabs, the viewer marked, each name linking its profile; one tap from the Tabella and in the sidebar. Ties share a place until #345. No division marks: a higher Élő-pont can sit in a lower division. | Peter, 2026-11-07 (D137); 2026-11-08 (D143) |
| L4 | "Hogyan működik a létra?" is behind a "?" next to the Tabella's title, in a tooltip (hover, tap or focus). | Peter, 2026-11-08 (D138) |
| N1 | On a phone the player's own sections are one tap away (bottom bar: Kezdőlap, Tabella, Értesítések with the unread count, Profil; the pair is a section of Profil since D141); the sidebar stays for the organizer and admin sections. | Peter, 2026-11-07; spec 16 |

## 8. Not in this round

- The admin pages (Áttekintés, Meccsek as a fixture list, groups one under the other): next round, reusing sections 2 and 3.
- Pair statistics in Párod beyond the link to the pair's profile.
- The Értesítések list itself (empty in the seed because the seed writes no notices).

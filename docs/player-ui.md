# Player UI: requirements

What the player-facing pages must do, compiled on 2026-11-07 from the spec, the rules, the decision log and Peter's review of the running round in the local seed (D127). The admin pages come later. The redesign that follows this document is D133.

Sources: [spec.md](spec.md) sections 3–9, 13, 14, 16, 17; [szabalyzat.md](szabalyzat.md); [decisions.md](decisions.md) D67, D68, D74, D77, D80, D85, D103a, D106, D108, D109, D112, D121.

## 1. Constraints that every page keeps

| # | Requirement | Source |
|---|---|---|
| C1 | Everything on screen is Hungarian, informal ("tegező") and short. Dates as "nov. 10., kedd 19:00", 24-hour time, Budapest time, decimal comma. | CLAUDE.md, spec 16 |
| C2 | Mobile first: most visits come from a phone link. At 390 px nothing scrolls sideways and nothing is cut off; tap targets are at least 40 px high. | spec 16, #146, `27-table-fit` |
| C3 | Desktop uses the width: no single narrow column with an empty right half. | Peter, 2026-11-07 |
| C4 | Phone numbers: only the current phase's opponents (tap to call) and the active partner (Párom). Never an email address of another player, never a phone number on a public page. | spec 3, D67, D121 |
| C5 | Group tables count final results only (confirmed, auto-accepted, organizer or deadline decision). A result waiting for confirmation or disputed never counts. One table computation (`groupTable`) for every page. | D80, D85 |
| C6 | Results read the same everywhere: pair A first, "4:2, 2:4, szuper tie-break 10:7"; both lose as "Mindkét pár vereséget kap (0:4, 0:4)". | D85 |
| C7 | The public league page shows names, tables and results only; a pair name links to its profile only for a logged-in member. No rating leaves the server. | spec 14, D112 |
| C8 | Logged-in pages sit in the app shell and use `AppPage` (one header, no own `<h1>`); shadcn/ui components first. | CLAUDE.md |
| C9 | Every player step on a match stays reachable whatever the state: propose, counter-propose, agreed time, accept, confirm/decline, venue, cancel, record/correct/confirm/dispute a result, substitute, no-show report. A redesign may fold a form away, never remove it. | spec 6–8, D68, D74, D77, D108, D109 |

## 2. Group table

| # | Requirement | Source |
|---|---|---|
| T1 | Columns: place, pair, played (M), wins (Gy), losses (V), sets won:lost (Szett), games won:lost (Játék), points (P). Ratios, not only differences, so a player can check the tiebreak by eye. Under 640 px Játék is left out, so the names keep room (T6); the league page on a wider screen has it. | Peter, 2026-11-07; spec 9 |
| T2 | The places that move at the end of the round are marked: 1st moves up (not in group 1), last moves down (not in the last group; in a group of 3 the 3rd). A legend says what the marks mean. | spec 10; Peter, 2026-11-07 |
| T3 | Before any final result the order is only the seeding: no place numbers and no up/down marks, so nobody reads the seed as a ranking. | D85 |
| T4 | The player's own pair is highlighted ("ti"). | D67 |
| T5 | Column headings are explained (title and a legend line), since M, Gy, V, P are abbreviations. | Peter, 2026-11-07 |
| T6 | At 390 px the table fits without sideways scroll; pair names wrap onto a second line rather than squeezing the numbers. | C2 |
| T7 | A pair withdrawn mid-phase is out of the table, listed under it as "Visszalépett". | spec 9, #34 |

## 3. Fixture list (a group's matches)

| # | Requirement | Source |
|---|---|---|
| F1 | Every match of the group, grouped by week (1.–3. hét with the dates), like a fixture list: pair A, the score or the time in the middle, pair B. | Peter, 2026-11-07; spec 5 |
| F2 | A played match shows its sets and who won (the winner in bold). | Peter, 2026-11-07 |
| F3 | A match without a final result shows its state: time and venue once fixed, "Egyeztetés alatt", "Eredmény megerősítésre vár" or "Vitatott eredmény". No match disappears from the list because of its state. | Peter, 2026-11-07; D80 |
| F4 | A group of 3 shows who rests that week. | spec 5 |
| F5 | The current week is marked. | spec 5 (play in the scheduled week is nudged) |

## 4. Kezdőlap

| # | Requirement | Source |
|---|---|---|
| H1 | "Teendők" first: every step waiting on the player, each a link, with its deadline where there is one (auto-accept time, phase deadline). | D67, spec 13 |
| H2 | The player's matches as cards, the whole card tappable: week and dates, opponents, the state in words, time and venue once fixed, the score once played, and call buttons for the opponents while the match is still to be played. | D67; Peter, 2026-11-07 |
| H3 | The group: division and group, round and deadline, the table (section 2) and the whole group's fixture list (section 3). | D67, D85; Peter, 2026-11-07 |
| H4 | Where the pair stands on the ladder: "Réz divízió, 2. csoport · még 1 feljutás a divízió éléig, 3 kör van hátra". | spec 14 |
| H5 | A link to the whole league (every group). | Peter, 2026-11-07 |
| H6 | The season card stays (entry button, strikes count) but the phase dates are folded away once the season runs. | D103a, #23; Peter, 2026-11-07 |
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

## 6. League page and navigation

| # | Requirement | Source |
|---|---|---|
| L1 | The public league page uses the same table (section 2) and fixture list (section 3) per group, in the division bands. | spec 14, D85 |
| L2 | At 390 px pair names don't break into four lines; at desktop width the table doesn't spread its numbers across the page. | Peter, 2026-11-07 |
| N1 | On a phone the player's own sections are one tap away (bottom bar: Kezdőlap, Tabella, Párom, Értesítések with the unread count, Profil); the sidebar stays for the organizer and admin sections. | Peter, 2026-11-07; spec 16 |

## 7. Not in this round

- The admin pages (Áttekintés, Meccsek as a fixture list, groups one under the other): next round, reusing sections 2 and 3.
- Párom statistics beyond the link to the pair's profile.
- The Értesítések list itself (empty in the seed because the seed writes no notices).

# Milestone 1 walkthrough (local)

A click-through checklist for milestone 1, "Registration opens": from the registration invite to published groups. It runs on a local database filled with fake data (#90). Nothing in it can reach production, and nothing is ever emailed: the local dev server logs every email to the console.

The page labels below are the Hungarian ones you see on screen.

## Set up

1. Install and configure once, from the repo root:
   - `npm ci`
   - Copy `app/.dev.vars.example` to `app/.dev.vars`. Set `TURNSTILE_SITE_KEY=""` (an empty key means no bot check, so asking for a login code works locally). Leave `RESEND_API_KEY=""` empty: with a key, a click on "Küldés" would try to send to the fake addresses for real. Also set `EMAIL_DAILY_LIMIT="1000"`: a full run sends about 100 emails (login codes included), and the default daily limit of 100 would leave the last group emails unsent (nothing sends the rest locally).
2. Migrate and seed the local database:
   - `npm run db:migrate:local -w app`
   - `npm run db:seed:local -w app`
3. Start the app with `npm run dev` and open <http://localhost:5173>.

The seed takes no options and refuses `--remote`, a production environment and CI. It only writes the local D1. Run it again at any time to start over: it deletes everything on `@example.test`, and the city "Mintaváros" with its league, clubs and signups (including everything a walkthrough created on top: accounts, pairs, entries, groups, held mail) and writes the same starting state again. Round 1 starts on the Monday about two weeks from the day you seed.

### What the seed contains

| Thing | Value |
|---|---|
| City | Mintaváros (listed), league "Padelpárbaj Mintaváros", slug `minta` |
| Clubs | Minta Padel Aréna, Teszt Sportcentrum, Példa Padel Club |
| Season | "Teszt szezon": registration open since yesterday, closes the Sunday before round 1; round 1 starts about two weeks out |
| Admin | `admin@example.test` (Teszt Admin) |
| Szervező | `szervezo@example.test` (Teszt Szervező) of Mintaváros |
| Signups | 10 pair signups and 4 solo signups, below |
| Player accounts | none: players register in step 5 |

The Admin and the Szervező already have accounts. Everyone else has only a signup, so they register themselves.

Pair signups (both players are named, so both get the registration invite). The level is the pair's shared signup level; it prefills the first-login page.

| # | Player 1 | Player 2 | Level |
|---|---|---|---|
| 1 | Kovács Anna `kovacs.anna@example.test` | Nagy Bence `nagy.bence@example.test` | Versenyző |
| 2 | Szabó Eszter `szabo.eszter@example.test` | Tóth Gergő `toth.gergo@example.test` | Haladó |
| 3 | Horváth Zsófia `horvath.zsofia@example.test` | Molnár Dávid `molnar.david@example.test` | Haladó |
| 4 | Farkas Lilla `farkas.lilla@example.test` | Papp Ádám `papp.adam@example.test` | Középhaladó |
| 5 | Takács Nóra `takacs.nora@example.test` | Juhász Bálint `juhasz.balint@example.test` | Középhaladó |
| 6 | Mészáros Réka `meszaros.reka@example.test` | Simon Levente `simon.levente@example.test` | Középhaladó |
| 7 | Török Hanna `torok.hanna@example.test` | Fehér Márk `feher.mark@example.test` | Középhaladó |
| 8 | Balogh Petra `balogh.petra@example.test` | Rácz Zoltán `racz.zoltan@example.test` | Kezdő |
| 9 | Lakatos Vivien `lakatos.vivien@example.test` | Gulyás Tamás `gulyas.tamas@example.test` | Kezdő |
| 10 | Oláh Kinga `olah.kinga@example.test` | Fodor Péter `fodor.peter@example.test` | Kezdő |

Solo signups:

| Player | Level | State |
|---|---|---|
| Varga Dóra `varga.dora@example.test` | Középhaladó | paired with Kiss Miklós by a Szervező |
| Kiss Miklós `kiss.miklos@example.test` | Középhaladó | paired with Varga Dóra |
| Pál Boglárka `pal.boglarka@example.test` | Kezdő | waiting for a partner |
| Sándor Ákos `sandor.akos@example.test` | Haladó | waiting for a partner |

### Logging in as a seeded user

There are no passwords. On <http://localhost:5173/login>:

1. Type the address and press "Kódot kérek".
2. Read the code in the terminal where `npm run dev` runs: a line `[email] to=<address> subject=...`, with the code as `NNN NNN` in the subject and the text.
3. Type the code in "Belépőkód" and press "Belépek".

Every user needs their own session. Use one browser window per account (a private window or a separate profile), or log out first: <http://localhost:5173/logout>. The Admin's session lasts 12 hours.

### Where held emails show up

Only login codes and signup confirmations go out by themselves. Every other email waits as a card on "Kimenő levelek" (`/admin/outbox`, Admin only, sidebar section Platform): one card per kind with the number of held emails and the oldest one's subject and text, with every address hidden. "Küldés" releases the whole kind; in the local dev server it prints each email to the terminal as `[email] to=... subject=...` and the text, and that is how you read what a player would get. "Elvetés" deletes them unsent.

The links in those emails point to `https://padelparbaj.hu/...`. Locally, open the same path on <http://localhost:5173> instead (for example `/login?email=...`).

## The flow

```mermaid
flowchart TD
  A["1-2. Admin: look around"] --> B["3. Admin: registration invite"]
  B --> C["4. Admin: Kimenő levelek, send"]
  C --> D["5. Players register"]
  D --> E["6. Pairs form from the signups"]
  E --> F["7. Pairs enter: Nevezünk"]
  F --> G["8. Szervező approves"]
  G --> H["9. Admin sends the decisions"]
  H --> I["10. Szervező drafts the groups"]
  I --> J["11. Szervező publishes"]
  J --> K["12. Admin sends the group emails"]
  L["13. Szervező pairs the waiting solos"] --> B
  M["14. Szervező changes pairs"] -.-> F
```

## Steps

Steps 1 to 12 are the main line. Steps 13 and 14 are side paths you can do any time after step 5.

### 1. Admin logs in

- Page: `/login`, then `/home` (Kezdőlap)
- Account: `admin@example.test`
- Expect:
  - You land on Kezdőlap with a "Teszt szezon" card (league Padelpárbaj Mintaváros): "Nevezés" dates, the four rounds with their deadlines, "Szezon vége:".
  - The sidebar shows "Platform" with the tag Admin, and a league section "Padelpárbaj Mintaváros" with the tag Szervező: Áttekintés, Szezonok, Párkeresők, Klubok.
  - No "Nevezünk" button: the Admin has no pair, so the card says "Nevezni párban lehet, és még nincs párod." with a link to Párom.

### 2. Admin checks the setup pages

- Account: `admin@example.test`
- Pages and expected results:
  - `/admin/cities` ("Városok"): Mintaváros is there and listed (shown on the signup form).
  - `/admin/leagues` ("Ligák"): Padelpárbaj Mintaváros with the organizer Teszt Szervező.
  - `/admin/leagues/minta/clubs` ("Klubok: Mintaváros"): the three clubs. "Inaktiválás" on one turns it off, "Aktiválás" turns it on again (deactivate instead of delete, #19). Leave all three active.
  - `/admin/leagues/minta/seasons` ("Szezonok"): the Teszt szezon with its four rounds, a link under "Nevezések" (0 jóváhagyva) and "Csoportok" under "1. kör". Try "Új szezon" with a start day that is not a Monday: it must be refused.
  - `/privacy`: opens without login; check that it describes pairs, season entries, the group emails and how long email text is kept.

### 3. Admin queues the registration invite

- Page: `/admin/signups` ("Jelentkezők")
- Account: `admin@example.test`
- Expect:
  - The header reads "14 jelentkezés · 10 pár · 4 egyéni · 24 játékos".
  - The button reads "Regisztrációs meghívó (22 cím)": both players of the 10 pair signups (20) plus the two solos a Szervező already paired. Pál Boglárka and Sándor Ákos wait for a partner, so they get nothing yet.
- Do: press the button, check the text of the dialog "Küldöd a regisztrációs meghívót?", press "Küldés".
- Expect:
  - The dialog says "Meghívók sorban": "22 levél vár a Kimenő levelek között".
  - The button is now disabled (everyone is invited once).
  - Nothing appears in the terminal: nothing was sent.

### 4. Admin releases the invite

- Page: `/admin/outbox` ("Kimenő levelek")
- Account: `admin@example.test`
- Expect:
  - One card, "Regisztrációs meghívó", with "22 levél". The preview shows a subject and text with no address in it (the login link's `?email=` is hidden).
- Do: press "Küldés" on the card and confirm in "Elküldöd?".
- Expect:
  - A notice at the top, and the card is gone ("Nincs visszatartott levél.").
  - The terminal prints 22 `[email] to=...` blocks, one per invited address, each with a link `https://padelparbaj.hu/login?email=<address>`.
- Optional, instead of "Küldés": press "Elvetés" and confirm in "Elveted?". The 22 emails are deleted unsent, and on "Jelentkezők" the invite button offers those addresses again (queue them again as in step 3).

### 5. Players register

- Page: `/login?email=<address>` (on localhost), then `/welcome` ("Üdv!"), then `/home`
- Accounts: the players from the tables above. Minimum: both players of 3 pair signups (6 logins, enough for one group of 3 pairs). For the full run use all 22 invited players: 11 pairs split into groups of 4, 4 and 3.
- Per player:
  1. Open the link from the terminal with the host changed to `http://localhost:5173`. The address is already filled in; press "Kódot kérek" and log in with the code from the terminal.
  2. On "Üdv!": type "Neved" (the name from the table), check that "Szinted" is already set to the signup's level, leave the phone empty (or try a Hungarian number), tick the privacy consent and press "Kész".
- Expect:
  - Without the consent or the name, the form shows an error and stays.
  - After "Kész" you land on Kezdőlap.
  - The first player of a pair opens "Párom" (`/pair`) and sees "A párod, <name>, még nem regisztrált." (the name, never the address).

### 6. The second partner registers, the pair forms

- Page: `/pair` ("Párom")
- Account: the second player of the pair, right after step 5 for them
- Expect:
  - After "Kész" the pair exists: Párom shows the partner's name. No invite step is needed.
  - The first partner sees the same after a reload.
  - A "Nevezés" card with the "Teszt szezon" and a "Nevezünk" button.
- Check for a pair of two solos (Varga Dóra and Kiss Miklós): the same, because the Szervező paired them before.

### 7. A pair enters the season

- Pages: `/pair` or `/home`
- Account: either player of a pair
- Do: press "Nevezünk".
- Expect:
  - "Neveztetek. A szervező döntését a Párom oldalon látjátok." and, after a reload, "Neveztetek. A szervező jóváhagyására vár."
  - The button is gone: a pair can enter a season once. The partner sees the same status.
- Repeat for every pair.

### 8. Szervező approves the entries

- Page: `/admin/leagues/minta/seasons/<id>/entries` ("Nevezések: Teszt szezon"), linked from "N függőben" on Szezonok
- Account: `szervezo@example.test` (only the Mintaváros league pages show in their sidebar)
- Expect:
  - The filter "Függőben" (default), "Jóváhagyva", "Elutasítva". Each row has the two names, their levels, the pair's average starting Elo and when they applied.
- Do: press "Jóváhagyás" on a pair, write a short message in "Üzenet (nem kötelező)", confirm. Press "Elutasítás" on another one, confirm, then change your mind with "Jóváhagyás" under "Elutasítva". Approve all the others.
- Expect:
  - The dialog says an email is prepared for both players and that the Admin sends it.
  - Approved entries show in "Jóváhagyva".
  - Back on the players' Párom: "Jóváhagyva: az 1. körtől játszotok." and "A szervező üzenete: ...".
  - Nothing is printed in the terminal yet.

### 9. Admin sends the decisions

- Page: `/admin/outbox`
- Account: `admin@example.test`
- Expect: a card "Döntés a nevezésről" with two emails per decided pair. Press "Küldés" and confirm; the terminal prints each email, with the Szervező's message where they wrote one.

### 10. Szervező drafts the groups

- Page: `/admin/leagues/minta/seasons/<id>/groups` ("Csoportok: Teszt szezon"), the "Csoportok" link in the "1. kör" column of Szezonok
- Account: `szervezo@example.test`
- Expect before drafting: a button "Csoportok javaslata". With 0, 1, 2 or 5 approved pairs there is no draft, only a message saying why.
- Do: press "Csoportok javaslata".
- Expect:
  - Cards "1. csoport", "2. csoport", ...; the strongest pairs (by Elo) in group 1. 11 pairs make 4, 4 and 3; 10 make 4, 3 and 3. Each pair shows its Elo.
  - Move a pair with the select "N. csoportba": the target group is re-seeded. A group of 2 or 5 shows a warning badge and "Közzététel" is disabled until every group has 3 or 4 pairs.
  - "Újragenerálás" throws the moves away and drafts again.

### 11. Szervező publishes the groups

- Page: the same
- Account: `szervezo@example.test`
- Do: press "Közzététel", read "Közzéteszed a csoportokat?", confirm.
- Expect:
  - The groups are locked: no select, no "Újragenerálás". The "1. kör" link on Szezonok now reads "Közzétéve", and the season can't be edited or deleted.
  - A pair in a published group can't be dissolved or changed ("Felbontás" and "Partner cseréje" on Párok are disabled, with the reason, until the round's deadline) and its entry can't be rejected.
  - A pair approved after publishing joins round 2 (to see it, keep one pair out of steps 7 and 8 until now, then let it enter and approve it: "Jóváhagyva: a 2. körtől játszotok.").

### 12. Admin sends the group emails

- Page: `/admin/outbox`
- Account: `admin@example.test`
- Expect: a card "Kihirdetett csoportok" with one email per player. Press "Küldés"; the terminal prints each player's group, the opponents' names per week (or the rest week), the deadline and a link. No email address of another player is in any of them.

### 13. Szervező pairs the waiting solos (side path)

- Page: `/admin/leagues/minta/solos` ("Párkeresők")
- Account: `szervezo@example.test`
- Expect: "2 egyedül jelentkező keres párt, 1 párt hoztál össze": Pál Boglárka and Sándor Ákos in the table, by level. The page never shows their addresses.
- Do: tick both, press "Párba teszem (2/2)", confirm.
- Expect:
  - "0 egyedül jelentkező keres párt, 2 párt hoztál össze".
  - A card "Párkeresők bemutatása" with 2 emails on "Kimenő levelek".
  - On "Jelentkezők" the invite button now reads "Regisztrációs meghívó (2 cím)". Queue and send it as in steps 3 and 4, then register them as in steps 5 to 7: their pair forms like the others once both have registered. "Szétválasztom" on this page undoes a pairing.

### 14. Szervező changes pairs (side path)

Players can't invite a partner or dissolve a pair themselves: the Szervező does it.

- Page: `/admin/leagues/minta/pairs` ("Párok")
- Account: `szervezo@example.test`
- Expect: every pair of the league with both names and levels, the average starting Elo, the source ("jelentkezésből" or "kézzel"), "Aktív" or "Felbontva", and the entry status in the current season. No email address anywhere.
- Do:
  1. "Pár létrehozása": pick two registered players without a pair (for example two whose signup partner hasn't registered), press "Létrehozás". The new pair shows with "kézzel".
  2. "Partner cseréje" on a pair: pick who stays and the new partner, press "Csere". The old pair reads "Felbontva", the new one "kézzel".
  3. "Felbontás" on a pair, confirm. It reads "Felbontva"; an entry it hasn't played in reads "Visszavonva".
- Expect:
  - Nothing new on Kimenő levelek: no email goes out for a pair change.
  - The players see the change on Párom. From here a new pair enters the season like any other (step 7).
  - After step 11, a pair in a published group has both buttons disabled, with the reason.

## Start over

Run `npm run db:seed:local -w app` again. It resets the fake rows, including every account, session, pair, entry, group, match and held email of the walkthrough, and refreshes the season dates. Rows that are not on `@example.test` and not in the city "Mintaváros" are left alone.

## What is not covered

- Google login (needs real credentials), web push and the Turnstile widget.
- Production behavior: real delivery through Resend, the daily quota in a live account, DNS and the deploy. The held outbox is checked here only up to the terminal output.
- Milestone 2 and later: scheduling matches, results, standings.

# Milestone 1 walkthrough (local)

A click-through checklist for milestone 1, "Registration opens": from registering through the league's register button to published groups. It runs on a local database filled with fake data (#90). Nothing in it can reach production, and nothing is ever emailed: the local dev server logs every email to the console.

The page labels below are the Hungarian ones you see on screen.

`npm run e2e` runs the same steps in a browser on its own local database (#101, see [e2e-tests.md](e2e-tests.md)). Which spec covers which step:

| Steps | Spec |
|---|---|
| 1-2 | [`01-admin-setup.spec.ts`](../app/e2e/01-admin-setup.spec.ts) |
| 3 | [`10-landing.spec.ts`](../app/e2e/10-landing.spec.ts) |
| 5-6 | [`03-register.spec.ts`](../app/e2e/03-register.spec.ts) |
| 7-9 | [`05-entries.spec.ts`](../app/e2e/05-entries.spec.ts) |
| 10-12 | [`06-groups.spec.ts`](../app/e2e/06-groups.spec.ts) |
| 11, a pair entering after publishing | [`07-late-entry.spec.ts`](../app/e2e/07-late-entry.spec.ts) |
| 13 | [`08-solos.spec.ts`](../app/e2e/08-solos.spec.ts) |
| 14 | [`09-pairs.spec.ts`](../app/e2e/09-pairs.spec.ts) |
| 14, search, filter and Levél nekik (#148) | [`15-pairs-filter.spec.ts`](../app/e2e/15-pairs-filter.spec.ts) |
| 15 | [`11-open-signup.spec.ts`](../app/e2e/11-open-signup.spec.ts) |
| 15, the second league's player (#331) | [`28-league-members.spec.ts`](../app/e2e/28-league-members.spec.ts) |
| 37, Párod and Korábbi párjaid on Profil (D141, D142) | [`30-pair-in-profile.spec.ts`](../app/e2e/30-pair-in-profile.spec.ts) |

## Set up

1. Install and configure once, from the repo root:
   - `npm ci`
   - Copy `app/.dev.vars.example` to `app/.dev.vars`. Set `TURNSTILE_SITE_KEY=""` (an empty key means no bot check, so asking for a login code works locally). Leave `RESEND_API_KEY=""`, `SMTP_USER=""` and `SMTP_PASSWORD=""` empty: with a Resend key or a relay login, every email of the walkthrough would really be sent to the fake addresses. Without a relay login the daily limit is 100 (`EMAIL_DAILY_LIMIT`), about what a full run sends: set `EMAIL_DAILY_LIMIT="1000"` in `.dev.vars` so no email waits for the next day.
2. Migrate and seed the local database:
   - `npm run db:migrate:local -w app`
   - `npm run db:seed:local -w app`
3. Start the app with `npm run dev` and open <http://localhost:5173>.

The seed takes no options and refuses `--remote`, a production environment and CI. It only writes the local D1. Run it again at any time to start over: it deletes everything on `@example.test`, and the cities "Mintaváros" and "Példaváros" with their leagues and clubs (including everything a walkthrough created on top: accounts, pairs, entries, groups, emails) and writes the same starting state again. Round 1 starts on the Monday about two weeks from the day you seed.

### What the seed contains

| Thing | Value |
|---|---|
| City | Mintaváros (listed), league "Padelpárbaj Mintaváros", slug `minta` |
| Second city | Példaváros (listed), league "Padelpárbaj Példaváros", slug `pelda`, no season (#331) |
| Clubs | Minta Padel Aréna, Teszt Sportcentrum, Példa Padel Club |
| Season | "Teszt szezon": registration open since yesterday, closes the Sunday before round 1; round 1 starts about two weeks out |
| Admin | `admin@example.test` (Teszt Admin) |
| Szervező | `szervezo@example.test` (Teszt Szervező) of Mintaváros |
| Second league's player | `idegen.ilona@example.test` (Idegen Ilona): joined Példaváros only, "Párt keresek" on there |
| Player accounts | none in Mintaváros: players register in step 5 |

The Admin and the Szervező already have accounts and belong to Mintaváros (D128). There is no interest list (#333): the players below have no account and nothing about them is stored; they register themselves through the league's register button, which makes them Mintaváros's players.

The pairs-to-be (each pair picks one level on the first-login page):

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

Players without a partner, who switch on "Párt keresek" for the Szervező to pair them:

| Player | Level | When |
|---|---|---|
| Varga Dóra `varga.dora@example.test` | Középhaladó | step 6, with Kiss Miklós |
| Kiss Miklós `kiss.miklos@example.test` | Középhaladó | step 6, with Varga Dóra |
| Pál Boglárka `pal.boglarka@example.test` | Kezdő | step 13 |
| Sándor Ákos `sandor.akos@example.test` | Haladó | step 13 |

### Logging in as a seeded user

There are no passwords. On <http://localhost:5173/login>:

1. Type the address and press "Kódot kérek".
2. Read the code in the terminal where `npm run dev` runs: a line `[email] to=<address> subject=...`, with the code as `NNN NNN` in the subject and the text.
3. Type the code in "Belépőkód" and press "Belépek".

Every user needs their own session. Use one browser window per account (a private window or a separate profile), or log out first: <http://localhost:5173/logout>. The Admin's session lasts 12 hours.

### Where emails show up

Every email goes out by itself, as soon as it is made (#112). In the local dev server it is printed to the terminal as `[email] to=... subject=...` and the text, and that is how you read what a player would get. "Kimenő levelek" (`/admin/outbox`, Admin only, sidebar section Platform) is the log: per kind, how many emails wait, went out and failed, with the newest failure's reason; never an address.

The links in those emails point to `https://padelparbaj.hu/...`. Locally, open the same path on <http://localhost:5173> instead (for example `/login?email=...`).

## The flow

```mermaid
flowchart TD
  A["1-2. Admin: look around"] --> B["3. Visitor: the league's register button"]
  B --> C["4. Admin: Kimenő levelek, the log"]
  C --> D["5. Players register through the button"]
  D --> E["6. Pairs form with the pair link"]
  E --> F["7. Pairs enter: Nevezünk"]
  F --> G["8. Szervező sees the entered pairs"]
  G --> H["9. Admin checks the entry emails went out"]
  H --> I["10. Szervező drafts the groups"]
  I --> J["11. Szervező publishes"]
  J --> K["12. Admin checks the group emails went out"]
  K --> N["17. Players see their group"]
  N --> O["18. Propose and accept a slot"]
  O --> P["19. Record and confirm an agreed time"]
  L["13. Szervező pairs two who look for a partner"] -.-> F
  M["14. Szervező changes pairs"] -.-> F
```

## Steps

Steps 1 to 12 and 17 to 19 are the main line. Steps 13 to 16 are side paths you can do any time after step 5.

### 1. Admin logs in

- Page: `/login`, then `/home` (Kezdőlap)
- Account: `admin@example.test`
- Expect:
  - You land on Kezdőlap with a "Teszt szezon" card (league Padelpárbaj Mintaváros): "Nevezés" dates, the four rounds with their deadlines, "Szezon vége:".
  - The sidebar shows "Platform" with the tag Admin, and a league section "Padelpárbaj Mintaváros" with the tag Szervező: Áttekintés, Szezonok, Párkeresők, Klubok.
  - No "Nevezünk" button: the Admin has no pair, so the card says "Nevezni párban lehet, és még nincs párod." with the link "Párod a Profilban".

### 2. Admin checks the setup pages

- Account: `admin@example.test`
- Pages and expected results:
  - `/admin` opens `/admin/leagues`; the sidebar has no "Jelentkezők", and `/admin/signups`, `/admin/poster` and `/admin/export.csv` lead to the admin home too (#333).
  - `/admin/cities` ("Városok"): Mintaváros and Példaváros are there and listed.
  - `/admin/leagues` ("Ligák"): Padelpárbaj Mintaváros with the organizer Teszt Szervező, and Padelpárbaj Példaváros.
  - `/admin/leagues/minta/clubs` ("Klubok: Mintaváros"): the three clubs. "Inaktiválás" on one turns it off, "Aktiválás" turns it on again (deactivate instead of delete, #19). Leave all three active.
  - `/admin/leagues/minta/seasons` ("Szezonok"): the Teszt szezon with its four rounds, a link under "Nevezések" (0 nevezett) and "Csoportok" under "1. kör". Try "Új szezon" with a start day that is not a Monday: it must be refused.
  - `/privacy`: opens without login; check that it describes pairs, season entries, the group emails and how long email text is kept, and says nothing about a signup or interest list (#334).

### 3. A visitor finds the league's register button

- Page: `/` (logged out)
- Expect:
  - The "Mintaváros: a liga állása" card in the hero, with its register button ("Nevezek az 1. körre" before the groups are out). The button opens `/register?league=minta`: the league rides along, so whoever registers through it is Mintaváros's player at once (D128, #331).
  - Példaváros has its own card, with its own button (`/register?league=pelda`).

### 4. Admin checks the log

- Page: `/admin/outbox` ("Kimenő levelek")
- Account: `admin@example.test`
- Expect:
  - Only login codes so far. No registration invite: there is no interest list (#333).
  - No address anywhere on the page, and no button: nothing waits for the Admin.

### 5. Players register through the register button

- Page: `/register?league=minta` (the landing page's button, step 3), then `/welcome` ("Üdv!"), then `/home`
- Accounts: the players from the tables above. Minimum: both players of 3 pairs (6 logins, enough for one group of 3 pairs). For the full run use the first 5 pairs and Varga Dóra and Kiss Miklós: 6 pairs before the draft (step 10), pair 6 for the late entry (step 11).
- Per player:
  1. Type the address, press "Kódot kérek" and enter the code from the terminal ("Tovább"). The account belongs to Mintaváros from this login on, before the first-login page is done.
  2. On "Üdv!": nothing is prefilled. Type the name from the table, pick the level in "Szinted", type a Hungarian phone number, pick "Férfi" or "Nő" (nothing is preselected, #133), tick the privacy consent and press "Kész".
- Expect:
  - Without the consent, the name or Férfi/Nő, the form shows an error and stays.
  - After "Kész" you land on Kezdőlap: the "Teszt szezon" card and "Hívd meg a párodat" with the player's own pair link. No "Melyik ligában játszol?" card: they joined through the button.

### 6. The partner accepts the pair link, the pair forms

- Pages: `/profile` (Profil, "Párod") of the first player, the link in the second player's window, `/profile` again
- Account: the first player of a pair, then the second (registered in step 5)
- Do: copy the link from "Hívd meg a párodat", open it as the second player, press "Elfogadom".
- Expect:
  - Párod shows "Mostantól párban vagytok." and the partner's name, email and phone; the first partner sees the same after a reload.
  - A "Nevezés" card with the "Teszt szezon" and a "Nevezünk" button.
- Varga Dóra and Kiss Miklós have nobody: each switches on "Párt keresek" in Párod (Profil), and the Szervező pairs them on Párkeresők (`/admin/leagues/minta/solos`, "Párba teszem", as in step 13). They get the in-app message "Párt találtunk neked" and the "Van párod" email.

### 7. A pair enters the season

- Pages: `/profile` or `/home`
- Account: either player of a pair
- Do: press "Nevezünk".
- Expect:
  - "Beneveztetek: az 1. körtől játszotok (kezdés: ...)." and, after a reload, "Beneveztetek: az 1. körtől játszotok." The entry counts at once: there is no organizer approval (#153).
  - The button is gone: a pair can enter a season once. The partner sees the same status.
  - Both players get "Beneveztetek" on Értesítések, and the terminal prints the "Beneveztetek" email to each of them at once (not to a player who switched email off on the profile).
- Repeat for every pair.

### 8. Szervező sees the entered pairs

- Page: `/admin/leagues/minta/seasons/<id>/entries` ("Nevezések: Teszt szezon"), linked from "N nevezett" on Szezonok
- Account: `szervezo@example.test` (only the Mintaváros league pages show in their sidebar)
- Expect:
  - "N nevezett pár". Each row has the two names, their levels, the pair's average starting Elo, when they entered and the round they start in.
  - Nothing to approve or reject, and no "függőben".

### 9. Admin checks the entry emails went out

- Page: `/admin/outbox`
- Account: `admin@example.test`
- Expect: a row "Nevezés" with two sent emails per pair (one fewer for a player who switched email off) and nothing waiting.

### 10. Szervező drafts the groups

- Page: `/admin/leagues/minta/seasons/<id>/groups` ("Csoportok: Teszt szezon"), the "Csoportok" link in the "1. kör" column of Szezonok
- Account: `szervezo@example.test`
- Expect before drafting: a button "Csoportok javaslata". With 0, 1, 2 or 5 entered pairs there is no draft, only a message saying why.
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
  - The terminal prints one email per player: the group, the opponents' names per week (or the rest week), the deadline and a link. No email address of another player is in any of them.
  - The groups are locked: no select, no "Újragenerálás". The "1. kör" link on Szezonok now reads "Közzétéve", and the season can't be edited or deleted.
  - A pair in a published group can't be dissolved or changed ("Felbontás" and "Partner cseréje" on Párok are disabled, with the reason, until the round's deadline).
  - A pair entering after publishing joins round 2 (to see it, keep one pair out of step 7 until now, then let it enter: "Beneveztetek: a 2. körtől játszotok.").

### 12. Admin checks the group emails went out

- Page: `/admin/outbox`
- Account: `admin@example.test`
- Expect: a row "Kihirdetett csoportok" with one sent email per player and nothing waiting.

### 13. Szervező pairs two who look for a partner (side path)

- Before: Pál Boglárka and Sándor Ákos register as in step 5 and switch on "Párt keresek" in Párod (Profil) (off by default, #333).
- Page: `/admin/leagues/minta/solos` ("Párkeresők")
- Account: `szervezo@example.test`
- Expect: "2 regisztrált játékos keres párt, 1 párt hoztál össze": the two under "Regisztráltak", by level, with their phone numbers. No "Még nem regisztráltak" part and no address. Idegen Ilona, who looks for a partner in Példaváros, is not listed.
- Do: tick both, press "Párba teszem (2/2)", confirm.
- Expect:
  - "0 regisztrált játékos keres párt, 2 párt hoztál össze"; the pair is under "Összehozott párok" and can be dissolved on Párok.
  - Both get the in-app message "Párt találtunk neked" and the "Van párod" email; Párod shows the partner.

### 14. Szervező changes pairs (side path)

Players can't invite a partner or dissolve a pair themselves: the Szervező does it.

- Page: `/admin/leagues/minta/pairs` ("Párok")
- Account: `szervezo@example.test`
- Expect: every pair of the league with both names and levels, the average starting Elo, the source ("kézzel", "linkkel", "Párkeresők"; "jelentkezésből" on pairs from before #333), "Aktív" or "Felbontva", and the entry status in the current season. No email address anywhere.
- Expect, between the intro text and the filter: nothing (no counts table, #298). The filter options show their counts.
- Expect, at 390px (#278): each pair is a card with both names, Elo, source, state, entry and its buttons; nothing is cut and nothing scrolls sideways. At desktop width it is the table.
- Do:
  1. "Pár létrehozása": pick two registered players without a pair (for example Török Hanna and Lakatos Vivien, registered as in step 5 but never paired), press "Létrehozás". Only Mintaváros's players are offered, never Idegen Ilona. The new pair shows with "kézzel".
  2. "Partner cseréje" on a pair: pick who stays and the new partner, press "Csere". The old pair reads "Felbontva", the new one "kézzel".
  3. "Felbontás" on a pair, confirm. It reads "Felbontva"; an entry it hasn't played in reads "Visszavonva".
  4. "Benevezés" under "Nem nevezett" on the new pair, confirm (the dialog names the pair). It reads "Nevezett", with the round it starts in ("a 2. körtől" after step 11). Try it on a pair where a player has no level: refused, naming the player.
  5. "Kivétel a szezonból" on that pair, confirm. It reads "Visszavonva" and stays "Aktív"; "Benevezés" enters it again. Pick "Visszavonva" in the filter: the rows' badge uses the same word. Both players' Párod reads "A szervező kivett titeket a szezonból. Ha újra játszanátok, szóljatok neki…", with no "Nevezünk" button.
  6. Type a name in "Keresés" without accents (for example "kovacs"): only the matching rows stay, and the address has `?q=`. "Szűrők törlése" brings every row back.
  7. Press "Nincs a ligában (N)": exactly N rows, the players without a pair ("Nincs párja", "Párt keres" where the switch is on) and the pairs without an entry. A reload keeps it. As `admin@example.test`, "Levél nekik" opens "Új körlevél" with those players as recipients ("Lista"); don't send.
- Expect:
  - Nothing new in the terminal or on Kimenő levelek: no email goes out for a pair change or an entry change.
  - The players see the change in Párod (Profil); an entry change also on Értesítések ("A szervező benevezett titeket", "A szervező kivett titeket a szezonból"). From here a new pair can also enter the season itself (step 7).
  - After step 11, a pair in a published group has both pair buttons disabled, with the reason, and "Kivétel a szezonból" opens "Visszaléptetés a csoportból" (#34): it needs a reason, and says the pair's matches leave the table and the pair leaves the season. After it the pair reads "Visszavonva", its pair buttons work again, and "Benevezés" enters it for the next round. The group's table on `/league/minta` no longer lists it (it is named below the table, "Visszalépett: …"), its matches there are gone, its players' Kezdőlap shows no group, and the other pairs' group table on Kezdőlap leaves it out, names it below ("Visszalépett: …") and shows its week's match as off. Értesítések: the pair got "A szervező visszaléptetett titeket a körből" with the reason; the others "Visszalépett egy pár a csoportodból" with no reason. No email.

### 15. A new player registers without a league and chooses one (side path)

Anyone can create an account, no invite needed (#113). Logging in on `/register` or `/login` directly, not through a league's button, the account belongs to no league until the player chooses one (D128, #331).

- Page: `/register` (or `/login`), then `/welcome`, `/home` and `/profile` (Profil, "Párod")
- Account: a new address that is not in the seed, for example `uj.jatekos@example.test`
- Do: ask for a login code, enter the code from the terminal, then fill in the first-login page (name, level, phone, consent) and press "Kész".
- Expect:
  - The code arrives like for anyone else; nothing about 2 November.
  - Under the code field: "Nem jött meg? Nézd meg a spam mappát is, adj meg másik címet, vagy írj nekünk: hello@padelparbaj.hu." (with "lépj be Google-lel" / "regisztrálj Google-lel" before the last part when Google login is set up). The same line for every address, also one that gets no code (#123).
  - The first-login page names no partner and prefills no level.
  - Kezdőlap: one card "Melyik ligában játszol?" with Mintaváros (Padelpárbaj Mintaváros) and "Csatlakozom"; Példaváros has no open season, so it is not offered. No season card and no pair link yet; Párod says "Még nem csatlakoztál egyik ligához sem." and links Kezdőlap.
  - After "Csatlakozom": the card is gone; Kezdőlap and Párod show the "Teszt szezon" and "Hívd meg a párodat" with the player's own pair link; Párod also says the organizer finds a partner for those with nobody, with the contact address `hello@padelparbaj.hu`. Napló has a "Csatlakozás ligához" entry by the player.
  - The Szervező can now pick this player on "Párok" (step 14).
  - As `idegen.ilona@example.test` (the second league's player): Kezdőlap shows no Mintaváros season and no card to choose, Párod her own Példaváros pair link with "Párt keresek" on. As the Admin, Példaváros's Párok lists only her, and Mintaváros's Párok, Párkeresők and Helyettes pick never list her.

### 16. The new player invites a partner with the pair link (side path)

A player without a pair sends their own link; the partner registers and accepts (decision log (`docs/decisions.md`), 2026-10-31).

- Page: `/home` as the player of step 15, then the link in a private window, `/register`, `/welcome`, the link again, `/profile`
- Account: another new address, for example `link.partner@example.test`
- Do: copy the link from "Hívd meg a párodat", open it in a private window, press "Regisztrálok", ask for a code, enter it, fill in the first-login page, then press "Elfogadom".
- Expect:
  - Logged out, the link shows "Új Játékos meghívott, hogy legyél a párja." and the league, never an email.
  - `/register` says "Regisztráció" and "Regisztráció Google-lel", the code step "Tovább"; it is the login flow.
  - After "Kész" the partner is back on the link; "Elfogadom" opens Profil's Párod section (`/profile?joined=1#parod`) with "Mostantól párban vagytok." and the partner's name.
  - Both players' link boxes are gone; on "Párok" the pair's source is "linkkel". No email was queued.
  - The player's own link, opened by themselves, says "Ez a saját linked."

### 17. Players see their group (after step 11)

- Page: `/home` ("Kezdőlap")
- Account: any player in a published group, for example the first pair's first player
- Expect:
  - "Teendők" at the top: "Ajánlj időpontot (<names> ellen)" for each match, each a link to the match with the round's deadline under it.
  - Three separate cards (D136). "Teendők" only while there is one.
  - "Meccseitek": a row per week 1 to 3 (D133, D136). With 6 pairs the groups have 3 pairs: 2 matches and one "Pihenőhét". Each row: the week and its dates, the opponents and the state ("Egyeztetésre vár"), the whole row a link to the match. The next match to play is open: its time and venue once fixed, the opponents' phone numbers (tap to call) and email addresses (`mailto:`, D135), and "A meccs oldala". No one else's email address.
  - A card "Bronz divízió, 1. csoport" (or "Réz divízió, 2. csoport"): the season and the round, where the pair stands ("A létra csúcsán vagytok, 3 kör van hátra"), "Tabella" (the league page), and the table (place, pair, M, Gy, V, Szett, Játék, P; "–" instead of places and "Még nincs végleges eredmény: a sorrend a kiemelés." until a result is final, D85). The group's matches are on the Tabella, not here.
  - "Hamarosan itt lesz a csoportod" is gone.

### 18. A pair gives its availability, the other picks a start

- Page: `/matches/<id>` (from "Egyeztetés és részletek"), then the same as an opponent
- Accounts: the player of step 17, then one of the opponents
- Do: pick a day chip, press "Délután 14–18", then add 16:00–19:00 with "Ettől"/"Eddig" and "Hozzáadom" (one range, 14:00–19:00), and press "Elküldöm a ráérésünket"; then pick another day, add 19:00–21:00 and send again.
- Expect:
  - The page starts with a summary (status, "Időpont", "Helyszín", the opponents' phones), then "Ajánljatok ráérést" open; "Máshol már megbeszéltétek?", "Már lejátszottátok? Rögzítsd az eredményt", "Helyettes kell?" and "Hogyan egyeztessetek?" (the 3-sentence guide) are folded below it (D133).
  - The first try is refused before sending: "Adj meg ráérést legalább 2 különböző napra." (D144).
  - The second goes through: "Elküldtük a ráéréseteket a másik párnak.", the status "Ajánlottatok időpontokat, a másik pár válaszára vár", and "Ekkor értek rá" lists both ranges. The terminal prints "Időpontokat ajánlottak a meccsetekre" to both opponents, with the ranges and the link.
  - As the opponent: Kezdőlap's Teendők has "Válaszolj az időpont-ajánlatra"; on the match, "Választható kezdések" shows each whole hour a match fits in (14:00–18:00 and 19:00, 20:00); pick one and press "Elfogadom": "Lefixáltátok a meccset.", "Lefixálva: <time>". "Napló" lists both steps with who and when. No email for the acceptance (it is a daily-digest item, #31); both pairs see it in "Értesítések".
  - Once scheduled, both pairs see "Naptárba" under the status (#192): "Google Naptár" (opens Google Calendar's new-event page with the time, 60 minutes, the four names, the club if recorded and the match link) and ".ics letöltése" (`/matches/<id>/calendar.ics`, only for the four players and the league's organizers; anyone else gets 404). The file never has an email address or phone number. Cancel the time: the row stays with only ".ics letöltése" and "Lemondták az időpontot…"; the downloaded file is STATUS:CANCELLED and removes the entry. A new time gives the same entry (same UID, higher SEQUENCE), so a new download replaces the old one.
  - Instead of accepting, the opponent can open "Egyik sem jó? Adjátok meg, mikor értek rá" and send their own ranges: it replaces the first proposal.
  - Sending times again on the same match the same day: the opponents get it in "Értesítések" (and by push), but the terminal prints no second email; one scheduling email per match a day to each player (#191).

### 19. A pair records an agreed time, the other confirms

- Page: the player's other match, then the same as an opponent
- Do: under "Máshol már megbeszéltétek?" pick tomorrow's day chip and the 22:00 hour chip and press "Rögzítem az időpontot"; as an opponent, press "Megerősítem" (or "Nem így beszéltük").
- Expect:
  - Any future whole hour before the deadline is fine (no 48 hours, no minimum, D144); the chips offer 7:00–22:00. "Rögzítettük. A másik pár megerősíti."; the terminal prints "Erősítsd meg a meccs időpontját" to both opponents.
  - Confirmed: "Lefixálva: <time>" for both pairs. Declined: back to "Egyeztetésre vár", and the recording pair gets an in-app notification.
  - Any other player opening `/matches/<id>` gets "Ez az oldal nem létezik."

### 20. Admin filters the Felhasználók list (side path)

- Page: `/admin/users` as the Admin
- Do: pick "Pár és nevezés" → "Nincs párja", then type a name in the search box, then press "Szűrők törlése".
- Expect:
  - Only accounts with the "Nincs párja" chip are listed; each option shows a count that matches the rows it would give with the other filters and the search.
  - The description says "N fiók (összesen M)" while anything is set; the address holds `?pair=none` (and `q=`), so a reload or a shared link shows the same list.
  - "Szűrők törlése" shows every account again. At 390 px the email and role sit under the name and no column is cut off.

### 21. A player's level locks after the first season (side path)

- Page: `/profile` as a player of a published group (step 11, for example the first pair's first player), then as a player without a group (step 15)
- Do: open Profil; open the "i" next to "Élő-pont"; on "Beállításaim" (`/profile?tab=settings`), as the second player, change "Szinted" and press "Mentés".
- Expect:
  - Profil has two tabs (D136): "Játékosprofil" (default: the summary Élő-pont, Szezon, Kör, Meccs, Győzelem, Vereség; then Meccsek and Párod once in a published group) and "Beállításaim" (Adataid, Fiók, Értesítések, Fiók törlése).
  - On "Beállításaim" the player in a group sees "Szinted" as plain text with the note "A szinted lezárult: …" and no way to change it; the other fields still save.
  - Both see the Élő-pont with the starting value of the level (kezdő 1000, középhaladó 1200, haladó 1400, versenyző 1600); the "i" opens a short explanation with a link to the Élő section of `/rules`.
  - The player without a group can change the level, and the number follows.

### 22. A player looks at the Tabella (the league page)

The ladder (decision log (`docs/decisions.md`), 2026-11-02, #30), for logged-in players only since D134. Needs step 11 done.

- Page: `/`, then `/league/minta`
- Account: none (logged out) first, then any player of step 11
- Do: on the landing page look for a link to the league page; open `/league/minta` logged out; log in, press "Tabella" in the sidebar (on a phone in the bottom bar), open "A csoport meccsei" under a group and "Hogyan működik a létra?" at the bottom.
- Expect:
  - The landing page's league card has no link to the league page, and logged out `/league/minta` goes to the login page and back to the Tabella after logging in (D134).
  - The Tabella sits in the app shell. The six pairs of the walkthrough are two groups of 3: "1. csoport" (Bronz divízió) and "2. csoport" (Réz divízió), each a card naming its division; the player's own group says "A ti csoportotok" and their row "(ti)".
  - Each group has a table (place, pair, M, Gy, V, Szett, Játék, P; Játék hides at 390 px) with all pairs at zero and "–" instead of places until a result is final (steps 27 and 28 change that). The marks and abbreviations are explained once under the groups.
  - "A csoport meccsei (3)" opens the group's matches by week (1. hét, 2. hét, 3. hét with the dates, the current week marked "ez a hét"): each with its agreed time (step 18 and 19) or "Egyeztetés alatt", and in a group of 3 who rests ("Pihen: …"). The player's own matches link to their page.
  - Only names: no email address, phone number or Élő-pont anywhere on the page, and the pair that joins later is not there.
  - At 390 px the page does not scroll sideways.
  - Before step 11 the page says "Még nincsenek kint a csoportok" and when round 1 starts.

### 23. The Szervező sees every match of the running phase (after step 19)

- Page: `/admin/leagues/minta/matches` ("Meccsek" in the league section of the sidebar)
- Account: the Szervező (or the Admin)
- Expect:
  - The season, the round and the deadline; a section per group ("Bronz divízió, 1. csoport"), the weeks inside it, and every match, named "<pair> a <pair> ellen" as on Viták (names only), the status ("Egyeztetésre vár", "Időpontokat ajánlottak, <pair> válaszára vár", "Megbeszélt időpont (<time>), <pair> megerősítésére vár", "Lefixálva: <time>, <venue>"), "Utolsó lépés: <time>" (or "Még nincs lépés") and who has stepped ("Mindkét pár lépett", "Csak <pair> lépett", "Még egyik pár sem lépett").
  - "Elakadtak (<n>)" shows only the stuck matches, with a red badge saying why: nobody has stepped by Wednesday of the match's week, or a proposal or agreed time has waited 48 hours without an answer (also after it lapsed). Before round 1 starts, a fresh walkthrough has none. The group and status selects narrow the list and the count; "Szűrők törlése" clears them.
  - After steps 27 and 28, the same page shows the results: "Lejátszva: …" or "Döntés: …" with score and winner (not stuck), and "Napló és telefonszámok" lists the result steps and the decision. A result waiting for confirmation or disputed is stuck ("Elakadt: az eredmény megerősítésre vár", "Elakadt: vitatott eredmény, dönts róla").
  - "Napló és telefonszámok" opens the match: status, both pairs with "Lépett" / "Még nem lépett" and their four phone numbers (tap to call), and "Napló" with every step: time, player, pair, what.
  - A player opening `/admin/leagues/minta/matches` gets "Ehhez nincs jogod" (403).

### 24. The booking pair records the venue; a pair cancels, in time and late

- Page: the match fixed in step 18, as the player of step 17, then as an opponent
- Do: under "Hol lesz a meccs?" pick "Minta Padel Aréna", type "2-es pálya", press "Mentem a helyszínt". Then "Lemondom a meccset" and "Lemondom". As the opponent, record an agreed time about 3 hours from now; as the first player, confirm it and cancel again.
- Expect:
  - Only the city's active clubs are offered. "Lefixálva: <time>, Minta Padel Aréna, 2-es pálya" for both pairs; nobody is notified, "Napló" has "Rögzítette a helyszínt".
  - Days ahead: the dialog asks "Lemondod a meccset?"; then "Lemondtátok. Egyeztessetek új időpontot." and "Egyeztetésre vár" for both pairs. The opponents get "Lemondták a meccset" in "Értesítések" (no email: it is a daily-digest item).
  - Under 24 hours before: the card already says "ez késői lemondás", the dialog asks "Késői lemondás. Biztosan lemondod?". Then "Későn mondtátok le, nektek kell új időpontokat ajánlani"; the opponents see "Későn mondták le, nekik kell új időpontokat ajánlaniuk" and no Teendő for this match, but can still propose. "Napló": "Lemondta a meccset (<time>). Késői lemondás: 24 órán belül volt." with who.

### 25. The morning digest and "holnap meccs" (cron)

- Page: none; the terminal of `npm run dev`, then "Értesítések"
- Do: run the cron job as if it were 07:00 Budapest, then 18:00: open `http://localhost:5173/cdn-cgi/local/scheduled?time=<milliseconds since 1970 of 07:00 Budapest, within a day from now>`, then again with the time of 18:00 the day before a fixed match.
- Expect (both emails are off for now, #191, D83; the in-app items and pushes stay):
  - 07:00: the day's reminders (for example "Még nincs időpont-ajánlat" from Wednesday of a match's week) are in "Értesítések" of the match's four players. No "Napi összefoglaló" email in the terminal. Running it again adds nothing.
  - 18:00 the day before a fixed match: "Holnap meccs" in "Értesítések" of the match's four players, with the time and the venue if recorded. No email.
  - Any other time: no new reminders (a run before noon makes the morning's only if no run did yet, #183). Every run pushes what waits in the push queue, within its limits.

### 26. Szervező checks the automatic reminders (side path)

People stuck before entering get at most one reminder per season, whatever the situation, once the league's switch is on (#155, #191).

- Page: `/admin/leagues/minta/reminders` ("Emlékeztetők")
- Account: Szervező
- Do: look at the table and the previews, switch "Automatikus emlékeztetők" on and confirm with "Bekapcsolom". Then run the cron job once: open `http://localhost:5173/cdn-cgi/local/scheduled`.
- Expect:
  - Off by default. The table lists the three situations with "Most kapná", "Elindult" and "Utoljára"; everyone in this walkthrough is newer than the waiting times (24 hours, 2 days), so "Most kapná" is 0; a registration deadline under 24 hours away shortens the 2 days to 24 hours, never less.
  - The note under the previews lists who never gets one, ending with "és aki ebben a szezonban már kapott emlékeztetőt".
  - With someone due, a preview shows their name and dates, never an email address, a phone number or the pair link's token.
  - Switching on sends nothing by itself; the scheduled run queues the reminders and prints them in the terminal, and a second run sends none again.

### 27. A pair records the result, the other confirms

- Page: the match of step 18 (`/matches/<id>`), then the same as an opponent
- Accounts: the player of step 17, then one of the opponents
- Do: under "Eredmény rögzítése" fill 4:3 and 4:1 ("Ti" first) and press "Rögzítem az eredményt"; then 4:1, 2:4 and the super tie-break 10:8, and send again. As the opponent, press "Megerősítem".
- Expect:
  - Before the result, the group card on Kezdőlap lists the pairs ("(ti)" marks yours) without numbers.
  - The first try is refused: "1. szett: 4:3 nem lehet. Lehet 4:0, 4:1, 4:2, 5:3 vagy (tie-break után) 5:4."
  - The second goes through: "Rögzítettük. A másik pár megerősíti.", the status "Rögzítettétek: 4:1, 2:4, szuper tie-break 10:8, a másik pár megerősítésére vár", with the time it is accepted by itself (48 hours later). Scheduling is gone from the page. The terminal prints "Erősítsd meg a meccs eredményét" to both opponents, with the score from their side (1:4, 4:2, 8:10) and the link.
  - Until the other pair answers, the recording pair can correct it ("Elírtátok? Javítsd ki"); the 48 hours restart.
  - As the opponent: Kezdőlap's Teendők has "Erősítsd meg az eredményt"; on the match, "Megerősítem": "Megerősítetted, az eredmény végleges.", "Lejátszva: 1:4, 4:2, szuper tie-break 8:10 (kikaptatok)". "Napló" lists both steps. No email for the confirmation (a daily-digest item, #31); all four players see it in "Értesítések". The group card on Kezdőlap now shows the table (#, Pár, M, P, Szett, Játék), the same as the Tabella.
  - Instead of confirming, "Nem így volt?" takes the opponent's own score (and an optional note): "Jeleztük a szervezőnek, ő dönt.", the status "Vitatott eredmény, a szervező dönt", and the match doesn't count until the organizer decides (step 28).
  - A result nobody answers is accepted by the cron (every 10 minutes) 48 hours after it was recorded; locally the cron doesn't run.

### 28. The other pair disputes a result, the Szervező decides

- Page: the match of step 19, then `/admin/leagues/minta/disputes` ("Viták" in the sidebar) and its "Döntök" link
- Accounts: the player of step 17, one of the opponents, then `szervezo@example.test`
- Do: record 4:2, 5:3; as the opponent, under "Nem így volt?" fill 4:2, 3:5, 10:7 with a note and press "Vitatom az eredményt". As the Szervező, open Viták, press "Döntök", pick an outcome, write a reason and press "Döntés mentése".
- Expect:
  - The opponent: "Jeleztük a szervezőnek, ő dönt.", the status "Vitatott eredmény, a szervező dönt". The match doesn't count; nobody takes more steps on it.
  - Told at once, in "Értesítések" (and by push, never by email, #178): the recording pair gets "Vitatják az eredményt" (link: the match); the league's Szervezők and the Admins get "Vitatott eredmény · <liga>", "A <n>. heti meccsek egyikének eredményét vitatják. A döntés rád vár." (link: the decide page); a Szervező or Admin who disputed it themselves gets nothing. No names, scores or contact details in the text. A Szervező or Admin who switched "Vitatott eredmény" off on the profile gets nothing.
  - As a player, `/admin/leagues/minta/disputes` and the decide page answer 403.
  - Viták: "Vitatott eredmények (1)", the match named "<pair> a <pair> ellen" (the decide page's title too), with both pairs' versions (from the 1. pár's side), then "Minden meccs" with every match of the published groups, each with "Felülbírálom". No email address or phone.
  - The decide page shows both versions, the note and the full log (1. pár / 2. pár). Without a reason the form doesn't send (the server refuses it too). After saving: "Elmentettük a döntést. Mindkét pár értesítést kap.", the decision in the log with the Szervező's name, time and reason, and Viták shows "Vitatott eredmények (0)".
  - Both pairs: "Végeredmény: <outcome>" ("Lejátszva: <score>" for a played match) and "A szervező döntött: … Indoklás: …" in the log; all four get it in "Értesítések" (no email: a daily-digest item, #31).
  - "Felülbírálom" works the same for any match, played or not; the latest decision counts.

### 29. A player sees the results in the group table (after steps 27 and 28)

The ladder counts final results (decision log (`docs/decisions.md`), 2026-11-03, #186).

- Page: `/league/minta`
- Account: any player
- Do: open the Tabella after the confirmation of step 27 and the decision of step 28, and open "A csoport meccsei" under the player's group.
- Expect:
  - In the player's group the table is no longer at zero: the player's pair has 3 points in 2 matches (the confirmed win of step 27 and the "both lose" decision of step 28, 0 points), the step 27 opponent 1 point in 1 match, the step 28 opponent 0 points in 1 match. Szett and Játék follow the rules (spec 9).
  - Both results are listed once (#202), under their own week: the sets from the 1. pár's side (4:1 over 2:4, the super tie-break as "(10:8)"), the winner in bold, and the decision as "Mindkét pár vereséget kap (0:4, 0:4)". The 1st of a group below the top one is marked to move up, the last of a group above the bottom one to move down.
  - Before the confirmation (a result still waiting) and while a result is disputed (step 28, before the decision) the table does not change; it changes when the result is confirmed, accepted after 48 hours, or decided.
  - Still no email address or phone number on the page.

### 30. Admin deletes an account (side path)

On a deletion request the Admin removes the account (#152, decision log (`docs/decisions.md`) D60).

- Page: `/admin/users` ("Felhasználók")
- Account: `admin@example.test`
- Do: "Törlés" on the player of step 15 (`uj.jatekos@example.test`; skip step 16, or their link pair goes with them), read the dialog, press "Törlés".
- Expect:
  - The dialog names the account and its address and says everything goes, because it has no history. "A fiók törölve." shows and the row is gone; the account isn't in Párok, Párkeresők or any count either, and logging in with the address starts a new registration.
  - "Törlés" on a player whose pair is in a published group (after step 11): the dialog says it can't be deleted until the pair is withdrawn, with no delete button. On your own row: "A saját fiókodat itt nem törölheted."
  - Nothing new in the terminal or on Kimenő levelek.
  - A Szervező has no Felhasználók page at all.

### 31. Admin reads the Napló (side path, after any organizer step)

Every organizer and system change leaves an entry (#225, #226, decision log (`docs/decisions.md`) D91).

- Page: `/admin/log` ("Napló", sidebar section Platform)
- Account: `admin@example.test`
- Do: open Napló; pick "Művelet: Csoportok közzététele", then "Ki: Teszt Szervező"; reload the page; set "Ettől" and "Eddig" to today.
- Expect:
  - The newest entry first, with Budapest time, who did it ("Rendszer" for the cron, "Törölt játékos" for a deleted account), the action in Hungarian (e.g. "Pár felbontása"), what it was done on by name (a pair as "Anna – Béla", never an id or an address) and the league.
  - Each filter narrows the list and stays in the address, so the reload shows the same list. 50 entries a page, "Régebbiek" for the next.
  - Nothing on the page changes an entry. A Szervező or a player opening `/admin/log` gets the 403 page, and has no Napló in the sidebar.

### 32. A pair asks for a substitute, the Szervező approves (after step 11)

Spec section 4, decision log (`docs/decisions.md`) D109 (#37).

- Page: a match of step 17 not played yet (`/matches/<id>`), then `/admin/leagues/minta/substitutes` ("Helyettesek" in the sidebar)
- Accounts: the player of step 17, then `szervezo@example.test`, then one of the opponents
- Do: on the match, under "Helyettes", pick your partner in "Ki nem tud játszani?" and a player of another group in "Ki helyettesít?", press "Helyettest kérek". As the Szervező, open Helyettesek and press "Jóváhagyom".
- Expect:
  - The picker shows names only, never an address, and never the match's four players or anyone in another pair of your group. "Elküldtük a kérést a szervezőnek. Szólunk, ha döntött." and the request "… helyett …: Jóváhagyásra vár", with "Visszavonom a kérést" for the player who asked (not for the partner).
  - The Szervező and the Admin get "Helyettes kérés · <liga>" in Értesítések (no names, no email); the asking player doesn't.
  - Helyettesek: the request under "Jóváhagyásra vár (1)" with the season, round, group and week, the pair and its opponents, the start (or the deadline), and the absent player's and the substitute's Elo side by side with the difference. "Jóváhagyom": "Jóváhagytad a helyettest. Mindkét pár értesítést kap.", and the request moves to "Jóváhagyva, még nem játszották", with "Visszavonom" until the match starts.
  - Both pairs see "<hiányzó> helyett <helyettes> játszik …" on the match page; the asking pair gets "Jóváhagyták a helyettest", the opponents "Helyettes az ellenfeleteknél" (app and push only, no email). The substitute gets nothing and gets 404 on the match page. The group table and the Tabella show the pair's own names.
  - "Elutasítom" with a reason instead: only the asking pair is told, and sees "Elutasítva" and "A szervező indoklása: …" on the match page; they can ask again.
  - After the confirmed result (step 27), the substitute's Elo changes and the absent player's doesn't.
  - Napló lists "Helyettes jóváhagyása" with the match and "<hiányzó> → <helyettes>". A player opening `/admin/leagues/minta/substitutes` gets 403.

### 33. A player opens a pair's and a player's profile (after step 29)

Profiles, for logged-in members only (#36, decision log (`docs/decisions.md`) D110, D112).

- Page: `/league/minta`, then a pair's name in a group table
- Account: none (logged out) first; then the player of step 27, on the Tabella and Profil
- Do: logged out, open a profile's address; logged in, press the player's pair in their group table, then one of the two names on the pair page.
- Expect:
  - Logged out: a profile's address goes to the login page and back to the profile after logging in.
  - While round 1 has not started (the seed's dates): names and groups only. The pair page says "Az eredmények a liga indulása után látszanak itt." and the player page shows no Élő-pont and "–" in the summary, although the Tabella already lists the results. The rest below shows once round 1 has started (the e2e spec moves its start into the past for a moment).
  - The pair page (`/pairs/<id>`): both names (each a link), "Csoportok" with "<season>, 1. kör: <n>. csoport (<division>)" and the pair's place in the table, the same as on the league page, and "Meccsek" with the step 27 win and the step 28 decision from the pair's side ("Győzelem · 4:1, 2:4, szuper tie-break 10:8", "Vereség · Mindkét pár vereséget kap (0:4, 0:4)"). A result still waiting or disputed is not listed.
  - The player page (`/players/<id>`): the name, the summary (D136: Élő-pont as a whole number, Szezon 1, Kör 1, Meccs, Győzelem, Vereség from the final results), "Párja" with the pair and its group, and the matches; the step 27 win has an "Élő-pont: +… → …" line, the decision has none (no Elo change). After two rated matches a small chart shows the rating.
  - No email address or phone number on either page. An unknown id, or a deleted player's page, is the 404 page ("Ez az oldal nem létezik."); a deleted player is "Törölt játékos" without a link.
  - Profil's "Játékosprofil" tab shows the same as the player page (with a link to it), and its Párod section "A párotok oldala", once the pair is in a published group.

### 33a. A player opens the Ranglista (after step 33)

The league's players and pairs by Élő-pont (decision log (`docs/decisions.md`) D137).

- Page: `/league/minta/rankings`
- Account: the player of step 27
- Do: press "Ranglista" in the sidebar (on a phone: "Ranglista" at the top of the Tabella), then the "Párok" tab.
- Expect:
  - While round 1 has not started (the seed's dates): "Az Élő-pontok a liga indulása után látszanak itt." and no rating.
  - Once it has started: "Játékosok" lists every player of the published groups with place, name (a link to the profile), Élő-pont and "Meccs" (rated matches), highest first; the player's own row says "(te)". Equal Élő-pont shares a place ("1., 1., 3.") and goes by name (#345 brings the tiebreaks).
  - "Párok" (`?view=pairs`) lists the pairs with the pair's Élő-pont, its players' average; the player's pair says "(ti)".
  - No email address or phone number on the page.

### 34. A player gets strikes; the Szervező cancels one (side path)

The deadline resolution (#11) gives strikes from the cron at 06:00 the morning after a phase's deadline, which local dev doesn't run on its own; the unit tests and `app/e2e/24-strikes.spec.ts` cover it. To see the pages, add strikes by hand to the local D1 for a player in a published group (decision log (`docs/decisions.md`) D103, D103a):

- Do: `npx wrangler d1 execute DB --local --command "insert into strikes (season_id, user_id, pair_id, source, at) select g.season_id, p.player_a, p.id, 'deadline', unixepoch() from group_pairs gp join groups g on g.id = gp.group_id join pairs p on p.id = gp.pair_id where g.published_at is not null limit 1"` (in `app/`), twice.
- Page: `/admin/leagues/minta/pairs` as `szervezo@example.test`.
- Expect:
  - The player's row on Párok shows "2 fekete pont"; below the list, "Fekete pontok · <szezon>" lists both, "Határidő: nem próbált egyeztetni", "Érvényes".
  - "Törlés" asks for a reason (the button stays off without one); after it the row says "Törölve (Teszt Szervező): <indok>" and the badge "1 fekete pont". Napló has "Fekete pont törlése" with the reason.
  - As that player, Kezdőlap's season card says "Fekete pontjaid ebben a szezonban: 1." The Tabella shows no strikes. Nothing new on Kimenő levelek (only a 2nd strike given by the cron sends the warning email).

### 35. A player deletes their own account (side path)

The same deletion as step 30, by the player (#38, decision log (`docs/decisions.md`) D111).

- Page: `/profile`, section "Fiók törlése" at the bottom
- Account: the player of step 15 (`uj.jatekos@example.test`; skip step 30, which deletes them), logged in on two browsers; then a player whose pair is in a published group (after step 11); then `admin@example.test`
- Do: press "Fiók törlése", read the dialog, press "Fiók törlése" in it; then reload the page on the other browser.
- Expect:
  - The dialog says everything goes, because there is no history ("Még nem szerepeltél a ligában…"), that every device is logged out, and "Nem vonható vissza."
  - After it: the home page with "Töröltük a fiókodat, és minden eszközön kiléptettünk.", logged out; the other browser is on the login page; logging in with the address starts a new registration. Nothing new in the terminal or on Kimenő levelek. Napló has "Fiók törlése" by "Törölt játékos".
  - The player in a published group: "Most nem törölheted: a párod kihirdetett csoportban játszik…" and no delete button. The Admin: "Adminként a saját fiókodat nem törölheted."

### 36. A pair reports a no-show; the Szervező confirms the walkover (side path, after step 11)

Spec section 8, decision log (`docs/decisions.md`) D108 (#33). A past slot can't be proposed, so put an agreed slot two hours ago on a match of step 17 by hand; `app/e2e/25-no-show.spec.ts` runs the same steps.

- Do: `npx wrangler d1 execute DB --local --command "update matches set status = 'scheduled', scheduled_at = unixepoch() - 7200, revision = revision + 1 where id = <match id>"` (from `app/`).
- Page: `/matches/<match id>`, then `/admin/leagues/minta/disputes` ("Viták"), then the match's decision page
- Accounts: a player of the match, then `szervezo@example.test`, then a player of the other pair
- Do: on the match, under "Nem jött el az ellenfél?", press "Nem jöttek el", then "Jelzem". As the Szervező, open Viták, press "Döntök" on the report, write a reason and press "Jóváhagyom".
- Expect:
  - Before the slot's start the card isn't there (and a hand-made request gets "Csak a meccs kezdete után jelezheted, hogy nem jöttek el.").
  - "Elküldtük a szervezőnek. Szólunk, ha döntött." and "Jeleztétek, hogy az ellenfeletek nem jött el (…)", with "Visszavonom a bejelentést" for the reporter only; the other pair sees "Az ellenfeletek jelezte, hogy nem jöttetek el (…)". No second report on the match.
  - The Szervező and the Admin get "Nem jöttek el · <liga>" in Értesítések (no names, no email; switchable on Profil as "Nem jöttek el"); the reporter doesn't.
  - Viták: "Nem jöttek el (1)" with the season, round, group and week, "<pár> szerint <pár> nem jött el", the slot and when it was reported. The decision page shows "Nem jöttek el: döntés" above the override form.
  - "Jóváhagyom": the match is final, a 4-0 4-0 walkover for the reporting pair (the group table and the Tabella count it); the log has "Nem jöttek el: a szervező jóváhagyta a bejelentést. <indok>". The other pair's two players get a strike ("Nem jelentetek meg egy lefixált meccsen."), which Párok lists with "Nem jelent meg". Both pairs are told in the app and by push; no email (a 2nd strike sends its own warning).
  - "Elutasítom" instead: nothing changes on the match; both pairs see "A szervező elutasította …" with the reason on the match page, and a new report can be made.
  - Napló lists "Nem jöttek el: jóváhagyás" (or "elutasítás") with the match. The deadline resolution leaves a match with a waiting report alone until the Szervező decides.

### 37. A player finds their pair and former pairs on Profil (after step 6)

The pair is a section of Profil, and Profil lists the pairs that ended (decision log (`docs/decisions.md`) D141, D142; `app/e2e/30-pair-in-profile.spec.ts`).

- Page: `/pair` (the old Párom address), then `/profile`
- Account: a player of step 6; then `idegen.ilona@example.test` with a second league (add a `league_members` row for Mintaváros by hand)
- Do: open `/pair` and `/pair?joined=1`; look at the sidebar and, at 390px, the bottom bar.
- Expect:
  - `/pair` lands on Profil's "Játékosprofil" tab at the "Párod" card, with the query kept (`/profile?joined=1#parod` says "Mostantól párban vagytok."). The card shows what Párom showed: the partner's name, email and phone, "A párotok oldala" once the pair is in a published group, and the season's entry; without a pair, "Hívd meg a párodat" with the pair link and the "Párt keresek" switch.
  - Neither the sidebar nor the bottom bar has Párom; Profil stays.
  - A player in two leagues sees one card per league under "Párod", each named after its league.
  - "Korábbi párjaid" is under Párod only once a pair of the player ended after playing in a published group (a Szervező's dissolve or partner change between rounds, or a partner's account deletion; the seed has none): the former partner (a link to the pair's page; "Törölt játékos" without a link for a deleted account), the league, the seasons and rounds ("Teszt szezon, 1. kör"), "Felbontva" or "Partnercsere" and the day it ended ("2026. 11. 30."), the newest first. No email address or phone number of a former partner.

## A running round instead

`npm run db:seed:season:local -w app` writes the same seed, then skips to the middle of round 1: every pair-to-be above and Varga Dóra and Kiss Miklós have a finished account in Mintaváros, 11 pairs are approved and in 3 published groups (4, 4, 3), and today is in week 2. The matches are in every state: final, a result waiting for confirmation, a dispute, a proposal, a counter-proposal, an agreed time, booked for tomorrow, played without a result, open. Log in as `kovacs.anna@example.test` (group 1: a result to confirm, a proposal to answer) or as the Szervező (Meccsek, Viták). Elo shows the starting values until the next result is confirmed in the app. Local only, with the same guard as the seed; running either seed again resets it.

## Start over

Run `npm run db:seed:local -w app` again. It resets the fake rows, including every account, session, pair, entry, group, match and email of the walkthrough, and refreshes the season dates. Rows that are not on `@example.test` and not in the city "Mintaváros" are left alone.

## What is not covered

- Google login (needs real credentials), web push and the Turnstile widget.
- Production behavior: real delivery through the Google SMTP relay or Resend, the daily limit in a live account, DNS and the deploy. Email is checked here only up to the terminal output.
- Milestone 2 and later: standings.
- The 48-hour auto-accept of a result (#28) and the deadline resolution (#11): the cron doesn't run on its own in local dev; the unit tests cover them.

# Club outreach

Messenger messages to the 3 Győr club owners (informal, "tegező"). Part of the organizer playbook (`go-to-market.md`). Replace the `[…]` parts before sending.

Decided 2026-10-02:
- Start date: depends on demand ("ha összegyűlik 12 pár"), target November 2026. (Was 8 until 2026-10-03.)
- Entry fee: none, players pay only the court. No plans to charge players (2026-10-04). Fine to mention if asked.
- The ask stays small: one poster with a QR code near reception. The player group post is a bonus.
- Clubs are not listed on the site (changed 2026-10-04). The club list is internal: each club gets its own poster QR code (`?ref=<club>`), so we can tell them how many players their poster brought in, and the signup form asks (optionally) where players play most.
- In the admin: add the club at `/admin/clubs`, then print its poster (printer icon, A4). Signups per club (by poster and by "where they play") are on the same page.

## 1. Poster request

> Szia [Név]!
>
> Peter vagyok, [én is szoktam nálatok játszani / a hétvégi versenyekről ismerhetsz]. Elindítok Győrben egy padelligát pároknak, Padelpárbaj néven: szint szerinti 4-es csoportok, heti egy meccs, a csoport végén feljutás és kiesés.
>
> A párok maguk foglalnak pályát a meccseikhez, bármelyik győri klubban. Így hétköznap is többen jönnek játszani, nem csak a versenyekre.
>
> Ha összegyűlik legalább 12 pár, november körül indulunk. Most gyűjtjük a jelentkezőket: https://padelparbaj.hu
>
> Kitehetnék nálatok egy plakátot QR-kóddal a recepció mellé? Ha belefér, a játékoscsoportotokban is megosztanám, de ez már csak extra.
>
> Cserébe a szezon végén megmutatom, hányan jelentkeztek a plakátotokról, és hány ligameccset játszottak nálatok. Köszi!
>
> Peter

## 2. Poster request + feedback (for the one owner you want an opinion from)

Same as above, with this paragraph before "Köszi!":

> Mielőtt nagyon belevágok, kíváncsi lennék a véleményedre is: szerinted működne ez Győrben? Van valami, amit klubként szívesen látnál benne, vagy ami zavarna? Ha van a héten 15 perced egy kávéra, szívesen elmondom részletesebben.

Questions worth asking over coffee:
- Which weekday time slots are empty at the club? (League matches could fill them.)
- Are the courts usable in winter (indoor or covered)? How many evening slots in November–February?
- Would a small league discount or a few reserved slots be realistic?
- Would they host a season-end event or finals day?
- How do they feel about players booking at other clubs too?

## 3. Facebook post kit (for clubs that agreed to post)

Decided 2026-10-05 (`go-to-market.md`): each club posts **natively** on its own page, with its own `?ref=<klub>-fb` link, so `/admin/traffic` shows which club's post brought signups. Send message 3a, then the post text 3b as a **separate message**, so the owner can copy it in one tap.

Per-club links:

| Club | Link in the post |
|---|---|
| Padel Club Győr | `padelparbaj.hu/?ref=padel-club-gyor-fb` |
| Padel Aréna Győr | `padelparbaj.hu/?ref=padel-arena-gyor-fb` |
| Marcal Teniszcentrum | `padelparbaj.hu/?ref=marcal-teniszcentrum-fb` |

### 3a. Messenger message with the requirements

> Szia [Név]!
>
> Köszi, hogy kiteszitek a ligát! A következő üzenetben küldöm a poszt szövegét. Nyugodtan formáljátok a saját stílusotokra, pár kérésem lenne csak:
>
> 1. **Saját posztként tegyétek ki** az oldalatokra, ne az enyémet osszátok meg, így sokkal több emberhez jut el.
> 2. **Ezt a linket használjátok**: padelparbaj.hu/?ref=[klub]-fb. Ebből látom, hányan jelentkeztek a ti posztotokról, és a szezon végén ezt meg is mutatom.
> 3. **Másold be a posztot a linkkel együtt**, várd meg, amíg betölt a liga képe, aztán a linket kitörölheted a szövegből. A kép megmarad, és rá kattintva a ti linketek nyílik meg. Saját fotót ne csatolj hozzá, mert akkor eltűnik a liga képe, és a link csúnyán látszik a szövegben.
> 4. Ha belefér, **hétköznap este, 19 és 21 óra között** posztoljátok, ilyenkor látják a legtöbben.
> 5. **Jelöljetek meg** a posztban, hogy kommentben válaszolni tudjak a kérdésekre.
>
> Ha van játékoscsoportotok, oda is mehet, de ez már csak extra. Köszi szépen!
>
> Peter

### 3b. The post (send as its own message, with the club's link filled in)

```
Sziasztok!

Elindul a Padelpárbaj: heti padelliga pároknak Győrben, és a meccseket nálunk is lejátszhatjátok! 🎾

• Szint szerinti csoportok
• Hetente 1 meccs, az időpontot ti egyeztetitek
• 3 hetente feljutás és kiesés
• Nincs párod? Jelentkezz egyedül, keresünk neked
• Nevezési díj nincs

Novemberben indul. Iratkozz fel, és jelöld meg a párodat! 👇
padelparbaj.hu/?ref=[klub]-fb
```
Based on Peter's own group post (2026-10-07), minus "Bármelyik klubban játszhattok": a club won't advertise playing at its competitors. No "ha összejön 12 pár" either: it sounds pessimistic.

Image: Facebook shows either an attached photo or the link preview card, not both, and a link left in the text looks messy. So the clubs do what Peter did: paste the text with the link, wait for the card, delete the link text. The card keeps the club's `?ref=` (since 2026-10-07 the page puts the `?ref=` in its og:url; before that, card clicks lost it). Keep the link on its own line: on 2026-10-07 the next line's text got glued to it (`?ref=padel-partner-gyor-fbJelöld`) and those clicks lost their source. Open the post's link once after posting to check. No own photo (decided 2026-10-07).

After they post: check `/admin/traffic` for the club's `-fb` ref the next day, and add a line to the outreach log below.

## If they ask

- **"Ez nem a konkurenciának visz játékost?"** It's a city league, not a club competition. Every club gets bookings, and no club is exclusive. The match venue is recorded, so each club sees its own numbers.
- **"Mennyibe kerül a klubnak?"** Nothing. The ask is a poster.
- **"Mi a különbség a Piramisbajnoksághoz képest?"** Pairs, fixed weekly rhythm, a local organizer, and scheduling on the site, with a walkover rule for pairs that don't respond.
- **"Mikor indul?"** When 12 pairs have signed up; target November.
- **"Fizetnek a játékosok?"** No entry fee; players only pay for the court, at the club.
- **"Tele vagyunk, nincs szükségünk több foglalásra."** Fine: the league isn't a bookings deal, it's for the players (new opponents every week, a city ranking). The ask is still just a poster. (Padel Club Győr, 2026-10-04.)

## 4. Registration open (2026-10-29): second ask

All three clubs get the same two messages, each with its own link from the table in section 3. The requirements are the same as in 3a, so the first message is short.

### 4a. Messenger message

> Szia [Név]!
>
> Megnyílt a nevezés a Padelpárbajra, november 9-én indul az első kör! Most lenne a legnagyobb segítség, ha kitennétek egy posztot az oldalatokra. A következő üzenetben küldöm a szöveget, a kérések ugyanazok, mint legutóbb: saját posztként, ezzel a linkkel, saját kép nélkül, és jelöljetek meg benne. Nyugodtan írjátok át a saját stílusotokra. Köszi szépen!

### 4b. The post (own message, club link filled in)

```
Sziasztok!

Megnyílt a nevezés a Padelpárbajra, a heti padelligára pároknak Győrben, és a meccseket nálunk is lejátszhatjátok! 🎾

• Szint szerinti csoportok, kezdőtől versenyzőig
• Hetente 1 meccs, az időpontot ti egyeztetitek
• 3 hetente feljutás és kiesés
• Nincs párod? Nevezz egyedül, keresnek neked
• Nevezési díj nincs

Első kör: november 9. Nevezés: november 6-ig.

Jelöld meg a párodat! 👇
padelparbaj.hu/?ref=[klub]-fb
```

## Outreach log

| Date | Club | Outcome | Follow-up |
|---|---|---|---|
| 2026-10-04 | Padel Club Győr | Owner supportive, likes the idea; was considering a similar competition himself. Nearly fully booked, so no booking benefit for them. OK to put up the poster and post on their Facebook page; offered to post it himself as page owner | Print and put up their poster (`/admin/klubok`). Send him the post text and the club's poster link (`?ref=`) so signups are counted. Court availability: league pairs may struggle to book there, so expect matches at the other clubs |
| 2026-10-07 | Padel Aréna Győr | Agreed to post about the league on their Facebook page | Sent the post kit (section 3) with `?ref=padel-arena-gyor-fb`. Check `/admin/traffic` the day after they post |

# Go-to-market

## Context
- Győr has 3 padel clubs, all booking through SportMate.
- Weekend tournaments draw 100–150 players, so the demand is there.
- Competitor: Piramisbajnokság (tennis and padel, challenge-based). They do no marketing, need at least 20 people to launch, and have no league in Győr.
- Our advantage is a local organizer (Peter) who is part of the community, plus a format built for pairs.

## Phase 0: validation (now)
1. Landing page (`/` in `app/`): explains the system and the rules, and collects interest from pairs or individual players.
2. **Talk to the clubs, all 3 of them, neutrally.**
   - The pitch: a city-wide league that brings **extra weekly bookings** to every club, from people who otherwise only play at weekend tournaments.
   - What we ask for: a poster or QR code at reception, a post in the club's player group, and optionally a league discount or reserved slots.
   - What we give: after the season, booking statistics per club (venue is recorded for every match).
   - The tournament club may not like sending players to competitors. Frame it as a city league, not a rival competition.
   - **No exclusivity** (2026-10-02). It would make scheduling harder (the biggest club is busy, and scarce slots mean walkovers), tie the league to one relationship, and lose the other clubs' posters. The ask is small anyway: one poster near reception.
   - Ways to keep clubs motivated without exclusivity:
     - A QR code per club (`?ref=<club>`), so we can tell each club "your poster brought in N players". Clubs are not listed on the site (2026-10-04); the club list is internal.
     - Visibility: tag the club in posts about each round's matches.
     - A carrot for the most helpful club: host the season-end event or finals day, or get a shout-out for offering a league discount.
   - When: Peter talks to the club owners once the website is live.
3. **Recruit in person** at weekend tournaments: a flyer with a QR code pointing to the landing page.
4. **Launch threshold:** 12 pairs (3 groups), decided 2026-10-03; was 8. With 2 groups the ladder barely moves.

## Social media

### Launch posts (decided 2026-10-05)
- No paid ads and no league Facebook page for now. Peter posts from his **own profile** (set to **Public**) and in 2–3 local padel groups.
- All 3 clubs agreed to post on their own pages. Send each club the club text, an image and its own link. They **post it natively**, not as a share of Peter's post: a shared personal post reaches few people and doesn't feel like the club's own.
- A separate `?ref=` per channel, so `/admin/traffic` shows what worked:
  - Peter's profile: `?ref=fb-peter`
  - Groups: one ref per group, `?ref=<csoport>-fb`, so each group shows separately. First: `padel-partner-gyor-fb` (private group, posted 2026-10-07)
  - Clubs: `?ref=<klub>-fb` (`-fb` keeps it apart from the club's poster QR)
- Groups:
  - Check each group's rules, or ask the admin first.
  - Spread the posts over a few days.
  - Reply to every comment quickly. Comments push the post up the feed.
- Image: a real photo of a Győr court or of Peter playing beats any graphic. Don't post without an image. Feed format: 1080×1350 (4:5).
- Best time: weekday evening, 19–21h.

### Schedule until launch
1. **Now:** announcement (post 1, post 2 for the clubs).
2. **~26 Oct:** social proof + urgency (post 3).
3. **2 Nov:** registration opens (post 4).

### Post 1: Peter's profile and groups
```
Padel liga indul Győrben 🎾

Sokan csak a hétvégi versenyeken játszunk tétmeccset, ezen szeretnék változtatni. Elindítom a Padelpárbajt: heti ligát pároknak.

• Hetente 1 meccs, hozzátok hasonló szintű párok ellen
• Az időpontot ti egyeztetitek, bármelyik győri pályán játszhattok
• 3 hetente a csoport győztese feljebb lép, az utolsó lejjebb kerül
• Nincs párod? Jelentkezz egyedül, keresünk neked
• Nevezési díj nincs, csak a pályadíjat álljátok

Novemberben indulunk, ha összejön 12 pár. Iratkozz fel, és szólunk, amikor nyílik a nevezés:
👉 padelparbaj.hu/?ref=fb-peter

Kérdés jöhet kommentben vagy üzenetben. Jelöld meg, akivel szívesen neveznél! 👇
```
In groups, swap the link to the group's own ref. The published group version (2026-10-07) opens with "Sziasztok! Elindítottam a Padelpárbajt: heti padel liga pároknak Győrben", adds "Bármelyik klubban játszhattok", drops "ha összejön 12 pár", and keeps only the preview card (link text deleted after the card loaded).

### Post 2: for the clubs
The final text, the requirements message and each club's link are in `club-outreach.md`, section 3 (Facebook post kit).

"Jelöld meg a párodat" matters most: it's a pairs league, so every tag brings in a new person.

### Post 3: ~26 Oct (draft)
```
Már [X] pár jelentkezett a győri Padelpárbajra 🎾 Még [Y] kell, hogy novemberben induljunk.

Ha eddig halogattad: most iratkozz fel, és jelöld meg a párodat! 👇
👉 padelparbaj.hu/?ref=fb-peter
```

### Post 4: 2 Nov (draft)
```
Nyílik a nevezés! 🎾

A Padelpárbaj első köre november 9-én indul Győrben. Regisztrálj, nevezz a pároddal, és hétfőn megkapjátok a csoportotokat.

👉 padelparbaj.hu/?ref=fb-peter
```
Check the dates against the milestones before posting.

### Later (after launch)
- A league Facebook page and Instagram account, posting via API.
- After each round: results, standings image, promotions and relegations, "a hét meccse".
- Share buttons for players ("feljutottunk az 1. csoportba"), so players do the distribution.
- Not allowed: an agent posting in Facebook groups. It would be flagged as spam and burn local trust. Group posts are always Peter's, in person.

## Organizer model (phase 3)
- Other cities can join only with a local organizer. We provide the platform and the know-how.
- The know-how is an **organizer playbook**, written down while running the Győr launch:
  - The club pitch.
  - Flyer and poster templates.
  - Launch checklist.
  - Rules and dispute-handling practice.

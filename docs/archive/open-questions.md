> Historical: these questions are all resolved and kept as history. The current source is the [spec](../spec.md) and the [decision log](../decisions.md).

# Open questions

All resolved on 2026-10-02 unless noted. Decisions are also in the decision log, [decisions.md](../decisions.md).

## Phase 0 (landing page)
1. ~~**Name and domain.**~~ ✅ **Padelpárbaj**, `padelparbaj.hu` at a Hungarian registrar, DNS on Cloudflare. City leagues: "Padelpárbaj Győr".
2. ~~**Where do signups go?**~~ ✅ Our own app: the form posts to the Worker, which stores it in D1 (`interest_signups`).
3. ~~**Hosting**~~ ✅ Cloudflare Workers, for the landing page and the app.
4. ~~**Contact details**~~ ✅ The interest form stays as it is (names, emails, level, comment). Phone number only at registration, optional (see #15).
5. ~~**Season start**~~ ✅ When 12 pairs have signed up (raised from 8 on 2026-10-03); target **November 2026**. Only some clubs have courts usable in winter: ask the owners about winter capacity.

## Rules
6. ~~Match format~~ ✅ 2 short sets to 4 (tie-break at 4-4), super tie-break to 10 as the decider, golden point; one format per league; 60-minute booking (changed from sets to 6 on 2026-10-04); unfinished matches continue in a new slot. See spec section 7.
7. ~~Phase length~~ ✅ 3 weeks, back to back, no catch-up week; new groups emailed on the Monday morning. Revisit if the first week turns out to be lost to late scheduling (the catch-up week stays a league setting).
8. ~~Both active, no agreement~~ ✅ Unplayed, 0 points for both, no Elo change; the organizer may award a walkover if one side clearly blocked the match.
9. ~~Late cancellation~~ ✅ Not an immediate walkover: the cancelling side must re-propose; if the match isn't played by the deadline, it counts as the inactive side.
10. ~~Scoring~~ ✅ 3/1/0: win 3, played loss 1, walkover loss 0.
11. ~~Pair count not divisible by 4~~ ✅ 3-pair groups fill the gap (2 matches each, one week off); no waiting list.
12. ~~Entry fee~~ ✅ No entry fee; players pay only the court. No plans to charge players (2026-10-04, replaces "first season free").
- ~~Elo starting values~~ ✅ kezdő 1000, középhaladó 1200, haladó 1400, versenyző 1600.
- ~~Home pair~~ ✅ No home pair: either side may propose first (changed 2026-10-03; was alternating home).

## Product and tech
13. ~~Stack confirmation~~ ✅ TypeScript, React Router, shadcn/ui, D1 + Drizzle, Better Auth. See CLAUDE.md.
14. ~~Email provider~~ ✅ Resend.
15. ~~Phone numbers~~ ✅ Optional, visible only to the current round's opponents, never public. Scheduling stays on the platform.
16. ~~Players without a partner~~ ✅ The organizer pairs them by hand in the first season (admin status "Párosítva"). A "keresek párt" list later, if there are many.
17. ~~PWA~~ ✅ Web push (PWA, opt-in) by the first round switch; instant emails only for items that need action, the rest in a daily digest (2026-10-05).
18. ~~**Little movement in the top and bottom groups.**~~ ✅ Partly (2026-10-08): 2 pairs swap at each border after the first phase of a league's first season, 1 up / 1 down after that. Rest stays open: With 1 up / 1 down, 3 of 4 pairs stay in the edge groups each round. Kept for season 1 (2026-10-06). If it gets boring, options: 2 up / 2 down, or 6-pair groups (5 where needed) with 5-week rounds, 3 rounds a season and 2 up / 2 down. All groups in a league must share the round length, so 4-pair and 6-pair groups can't mix in one season.
19. ~~**One ladder means one winner.**~~ ✅ Virtual divisions (2026-10-08): the ladder is cut into thirds, Bronz / Réz / Rookie (MAPASZ level names since 2026-10-23; first named haladó / középhaladó / kezdő), still one ladder. Winners: 1st of each division's top group and every group's 1st, last phase. No separate divisions, no finals event. Original question: All pairs play in one ladder, so only the top group's winner really wins the season, and prizes are hard to hand out. "Szint szerinti csoportok" in posts may also suggest separate level categories (raised 2026-10-07, brainstorm later). Options to discuss: separate divisions (e.g. kezdő / haladó) with their own winners, prizes per group or per tier at the season end, extra titles (most improved Elo, most matches played).
20. **Women's league?** No gender question on the form (2026-10-07). Peter picks out the women among the signups by hand and asks them whether they want their own league. Depends on numbers: a league needs at least one group of 3–4 pairs. Open: what about mixed pairs?

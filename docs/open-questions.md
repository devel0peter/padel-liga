# Open questions

## Blocks phase 0 (landing page)
1. **Name and domain.** "Győri Padel Liga" is a placeholder. Should the brand be city-neutral (because of multi-city) with Győr as one league inside it?
2. **Where do signups go?** Options: Formspree or Tally (zero code), or a minimal ASP.NET endpoint with SQLite (the start of the real repo).
3. **Hosting** for the landing page: homelab behind Cloudflare Tunnel, Cloudflare Pages, or a VPS?
4. **Which contact details to collect?** Currently name and email for both players, a level, and a comment. Phone number too?
5. **Planned start of the first season?** Indoor vs. outdoor courts in winter?

## Rules
6. Match format: 2 sets with a super tie-break and golden point? Or a fixed-length match, given that court time is booked in 60/90-minute slots?
7. Phase of 3 weeks, or 3+1 with a catch-up week?
8. Both sides active but no agreement: 0 points for both, or does the organizer decide?
9. Late cancellation (under 24 hours): walkover?
10. Scoring: wins only, or 3/1/0 (reward for showing up)?
11. Odd number of pairs: a group of 3 or 5, or a waiting list?
12. Entry fee: is the first season free?

## Product and tech
13. Stack confirmation: .NET 10 + Blazor SSR/Razor Pages + Postgres + ASP.NET Identity?
14. Email provider (Brevo, Postmark, SES)?
15. Phone numbers visible to opponents, or keep everything on the platform?
16. Players without a partner: a separate "keresek párt" (looking for a partner) list in the MVP?
17. Should the MVP include a PWA (installable, push notifications), or is email enough?

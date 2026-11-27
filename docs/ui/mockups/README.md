# Player UI mockups, direction A

Approved by Peter on 2026-11-27 (epic #417). These are the reference for the player pages: colours, type, spacing and the order of things on each screen. The rules behind them are in `docs/ui-guidelines.md` (#418).

Each screen has a phone version (`-m`, 390 px wide) and a desktop version (`-d`, 1280 px wide). The `.dc.html` files are static HTML with inline styles: open one in a browser to read exact values. The `.png` files are renders of the same files. The data is the local season seed (`npm run db:seed:season:local`); the names are fake.

| File | Screen | Ticket |
|---|---|---|
| `P01-Kezdolap-*` | Kezdőlap | #420 |
| `P02-Eredmeny-*` | Match page, result to confirm | #421 |
| `P03-Idopont-*` | Match page, pick a time | #421 |
| `P04-Tabella-*` | Tabella | #422 |
| `P05-Ranglista-*` | Ranglista | #422 |
| `P06-Ligaim-*` | Ligáim | #423 |
| `P07-Ertesitesek-*` | Értesítések | #423 |
| `P08-Profil-*` | Profil and settings | #424, #419 |
| `P09-Par-*` | Pair page | #424 |
| `P10-Nevkartya-m` | One-time surname card on Kezdőlap | #419 |

Pairs are shown by surname ("Kovács / Nagy"), see #419. Where a mockup and `docs/spec.md` disagree on behaviour, the spec wins; the mockup decides only the look.

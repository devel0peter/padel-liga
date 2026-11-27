# UI guidelines: direction A ("Eredményjelző")

How a player page is built (D181, epic #417). The look comes from the approved mockups in [`ui/mockups/`](ui/mockups/README.md); what each page must do stays in [`player-ui.md`](player-ui.md) and the spec. Organizer and admin pages keep their own layout and take the colours from the same tokens.

## Building blocks

Player pages are made of the blocks in `app/app/components/blocks/`, shown in every state at `/dev/ui` (local dev only, `npm run dev`). A pattern that isn't there needs a mockup Peter approved first; then it becomes a block, not page markup.

| Block | For |
|---|---|
| `PageHeader` | Way back, eyebrow line (season, city, round), display title, a slot on the right |
| `SectionLabel` | The title above a card ("Meccseid az 1. körben"); amber only for "Rád vár" |
| `ActionCard` | One thing that waits on the player: badge or icon, title, one or two lines, buttons or a link |
| `RoundProgress` | Round, week, days left, deadline, bar |
| `BigRank` | The pair's place as a big number, with its caption |
| `StatTile` | A number as a tile (label, number, change) |
| `TeamBadge`, `TeamName` | A pair's two initials (colour from the pair id) and its name, "TI" on the viewer's own |
| `StatusPill` | A short status in the status colours |
| `ListCard`, `ListRow`, `MatchRow` | Cards of rows: links with a chevron, the player's matches |
| `ScoreBoard` | A result: two team rows × set boxes, the winner marked |
| `SlotPicker` | Time chips by day, one to pick |
| `Segmented` | A two- or three-way switch |
| `OverflowRow` | "•••": the rare or destructive actions |

Buttons are shadcn's `Button` with `size="xl"` (44 px): `default` is the yellow primary, `secondary` the dark one.

## Rules

1. **Status and what to do come first.** The top of a screen says where the player stands and what waits on them ("Rád vár"), before anything to read.
2. **At most one primary (yellow) action per screen.** Everything else is secondary, a link row, or folded.
3. **Information that needs no action is hidden** behind a row, a tab or another page. No block is there "for completeness".
4. **Rare or destructive actions go into an overflow row** ("•••"), last on the page, never as a button beside the main one.
5. **Numbers as tiles**: places, points, matches and Élő-pont are `BigRank` or `StatTile`, in the condensed display type, not in a sentence.
6. **Status colours mean one thing each** (below); no colour for decoration.
7. **Hungarian formats** (CLAUDE.md): `dec. 6., vasárnap 23:59`, 24-hour time, decimal comma (`1287,5`), the change with its sign (`+4`, `−3`).
8. **Touch targets at least 44 px** high (buttons, chips, rows, tabs; a visually smaller pill reaches 44 px with its hit area).
9. **Text contrast at least 4.5:1** on the surface it sits on. Every text token reaches it on every surface (the table is in #418's PR); a new colour pair needs the same check.

## Status colours

| Token | Colour | Means | Examples |
|---|---|---|---|
| `ball` | `#dceb3c` | The one primary action; the active nav item; the player's own row | "Megerősítem", the own pair in a table |
| `success` | `#5fd492` | Done, won, going up | "Győzelem", "+4", "feljut" |
| `warning` | `#f7b955` | Waits on the player | "Rád vár", "Megerősítésre vár", the unread count |
| `info` | `#7cb2ff` | Needs a time, scheduling | "Időpont kell" |
| `danger` | `#ff8f80` | Lost, going down, a problem | "Vereség", "kieső hely", "Vitatott" |
| neutral | `surface-3` | Everything else | "Fix időpont", "Lejátszva" |

Each status has a 16% tint (`bg-success-tint` …) for pill backgrounds, with the status colour as text. Divisions have their dots: Bronz `#d08a4a`, Réz `#3fbf9f`, Rookie `#9b7bff`.

## Type and surfaces

- **Archivo**, one family. Display (`type-display`): weight 800, `font-stretch: 75%`, upper case, for page titles, team names in headers and big numbers. Body `text-body` 15 px; captions `text-caption` 13 px; section labels `type-label` 13 px, 700, letter-spacing 0.08em, upper case.
- **Dark for everyone**, no light theme. Ground `#0a1424`; cards `surface` `#111f36`; tiles and chips on a card `surface-2` `#1a2c49`; secondary buttons and the active tab `surface-3` `#1f3355`. Text `#eef3f9`, muted `#a3b3c9`.
- Use the tokens (`bg-surface`, `text-muted-foreground`, `text-warning` …), never a raw colour or a Tailwind palette colour in a page.

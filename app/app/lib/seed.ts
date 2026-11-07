// Fake data for walking through milestone 1 on a local database (#90,
// docs/walkthrough.md). Pure (no I/O): it builds SQL and decides whether a run
// is allowed; scripts/seed-local.ts runs it against the local D1 only.
//
// Everything it writes is recognisable and removable: addresses end in
// @example.test (a reserved domain, so mail to them goes nowhere), and the
// cities, leagues and clubs have fixed slugs. Running it again first deletes
// all of that, including what a walkthrough created on top (pairs, entries,
// groups, emails), then writes the same starting state again.
//
// No interest list (#333, D129): the players have no account yet; they
// register through the league's register button (D128), as the walkthrough
// says. A second league in a second city, with one player who joined it,
// shows that a league's pages only hold its own players (#331).

import { addDays, budapestDay, budapestTime, isMonday, phaseCalendar } from "@padel-liga/rules";

export const SEED_EMAIL_DOMAIN = "example.test";
export const CITY = { slug: "minta", name: "Mintaváros" } as const;
export const LEAGUE = { slug: "minta", name: "Padelpárbaj Mintaváros" } as const;
export const SEASON_NAME = "Teszt szezon";
// The second league (#331): listed, no season, one player.
export const OTHER_CITY = { slug: "pelda", name: "Példaváros" } as const;
export const OTHER_LEAGUE = { slug: "pelda", name: "Padelpárbaj Példaváros" } as const;

export const ADMIN = { id: "seed-admin", email: `admin@${SEED_EMAIL_DOMAIN}`, name: "Teszt Admin" } as const;
export const ORGANIZER = { id: "seed-organizer", email: `szervezo@${SEED_EMAIL_DOMAIN}`, name: "Teszt Szervező" } as const;
// A registered player of the second league only.
export const OUTSIDER = { id: "seed-outsider", email: `idegen.ilona@${SEED_EMAIL_DOMAIN}`, name: "Idegen Ilona" } as const;

export const CLUBS = [
  { slug: "minta-padel-arena", name: "Minta Padel Aréna" },
  { slug: "teszt-sportcentrum", name: "Teszt Sportcentrum" },
  { slug: "pelda-padel-club", name: "Példa Padel Club" },
] as const;

type Level = "kezdo" | "kozephalado" | "halado" | "versenyzo";
type Person = { name: string; email: string };

const person = (name: string, local: string): Person => ({ name, email: `${local}@${SEED_EMAIL_DOMAIN}` });

// The walkthrough's players, who register themselves (none has an account):
// ten pairs-to-be, each with one level both pick on the first-login page.
export const PAIR_PLAYERS: { a: Person; b: Person; level: Level }[] = [
  { a: person("Kovács Anna", "kovacs.anna"), b: person("Nagy Bence", "nagy.bence"), level: "versenyzo" },
  { a: person("Szabó Eszter", "szabo.eszter"), b: person("Tóth Gergő", "toth.gergo"), level: "halado" },
  { a: person("Horváth Zsófia", "horvath.zsofia"), b: person("Molnár Dávid", "molnar.david"), level: "halado" },
  { a: person("Farkas Lilla", "farkas.lilla"), b: person("Papp Ádám", "papp.adam"), level: "kozephalado" },
  { a: person("Takács Nóra", "takacs.nora"), b: person("Juhász Bálint", "juhasz.balint"), level: "kozephalado" },
  { a: person("Mészáros Réka", "meszaros.reka"), b: person("Simon Levente", "simon.levente"), level: "kozephalado" },
  { a: person("Török Hanna", "torok.hanna"), b: person("Fehér Márk", "feher.mark"), level: "kozephalado" },
  { a: person("Balogh Petra", "balogh.petra"), b: person("Rácz Zoltán", "racz.zoltan"), level: "kezdo" },
  { a: person("Lakatos Vivien", "lakatos.vivien"), b: person("Gulyás Tamás", "gulyas.tamas"), level: "kezdo" },
  { a: person("Oláh Kinga", "olah.kinga"), b: person("Fodor Péter", "fodor.peter"), level: "kezdo" },
];

// And four players without a partner, who switch on "Párt keresek" so the
// Szervező pairs them on Párkeresők.
export const SOLO_PLAYERS: { who: Person; level: Level }[] = [
  { who: person("Varga Dóra", "varga.dora"), level: "kozephalado" },
  { who: person("Kiss Miklós", "kiss.miklos"), level: "kozephalado" },
  { who: person("Pál Boglárka", "pal.boglarka"), level: "kezdo" },
  { who: person("Sándor Ákos", "sandor.akos"), level: "halado" },
];

// Every address the seed or the walkthrough uses.
export function seedEmails(): string[] {
  return [
    ADMIN.email,
    ORGANIZER.email,
    OUTSIDER.email,
    ...PAIR_PLAYERS.flatMap((p) => [p.a.email, p.b.email]),
    ...SOLO_PLAYERS.map((s) => s.who.email),
  ];
}

// --- Guard --------------------------------------------------------------------

export type Env = Readonly<Record<string, string | undefined>>;

// The seed deletes and writes many rows, so it takes no options at all: there
// is no flag that could point it elsewhere. Anything on the command line is
// refused, with a clearer message for the flags that mean "not local".
export function assertLocalOnly(argv: readonly string[], env: Env): void {
  const remote = argv.find((a) => /^--(remote|preview|production|env)\b/.test(a));
  if (remote) throw new Error(`Refused: ${remote}. The seed only writes the local database.`);
  if (argv.length > 0) throw new Error(`Refused: unknown option ${argv[0]}. The seed takes no options.`);
  if (env.CI) throw new Error("Refused: CI is set. The seed is for a developer's machine.");
  if (env.NODE_ENV === "production") throw new Error("Refused: NODE_ENV is production.");
}

// The wrangler command that runs the seed file. Always the local database;
// the check below is the last line before anything runs.
export function wranglerArgs(file: string): string[] {
  const args = ["wrangler", "d1", "execute", "DB", "--local", "--file", file];
  assertLocalArgs(args);
  return args;
}

export function assertLocalArgs(args: readonly string[]): void {
  if (!args.includes("--local")) throw new Error("Refused: the wrangler command is not --local.");
  const bad = args.find((a) => /^--(remote|preview|env)\b/.test(a));
  if (bad) throw new Error(`Refused: the wrangler command has ${bad}.`);
}

// --- SQL ----------------------------------------------------------------------

const q = (s: string | null): string => (s === null ? "NULL" : `'${s.replaceAll("'", "''")}'`);
const secs = (d: Date): number => Math.floor(d.getTime() / 1000);

const SEED_USERS = `select id from users where lower(email) like '%@${SEED_EMAIL_DOMAIN}'`;
const SEED_LEAGUES = `select id from leagues where slug in (${q(LEAGUE.slug)}, ${q(OTHER_LEAGUE.slug)})`;
const like = (column: string): string => `lower(${column}) like '%@${SEED_EMAIL_DOMAIN}'`;

// Deletes the seed's rows and whatever hangs off them. The order follows the
// foreign keys: pairs have no cascade from users, so they go first; the
// league takes its seasons, entries, groups and matches with it.
export function resetStatements(): string[] {
  return [
    `delete from broadcasts where ${like("created_by")}`,
    `delete from email_messages where ${like("to_email")}`,
    `delete from pair_invites where league_id in (${SEED_LEAGUES}) or inviter_id in (${SEED_USERS}) or ${like("invitee_email")}`,
    `delete from pairs where league_id in (${SEED_LEAGUES}) or player_a in (${SEED_USERS}) or player_b in (${SEED_USERS})`,
    // Before the league: its system entries (actor null) go by league_id (#225).
    `delete from audit_log where actor_id in (${SEED_USERS}) or league_id in (${SEED_LEAGUES}) or ${like("target")} or target = ${q(`league:${LEAGUE.slug}`)} or target in (select 'user:' || id from users where ${like("email")})`,
    // league_members goes with its league and its users (cascade).
    `delete from leagues where slug in (${q(LEAGUE.slug)}, ${q(OTHER_LEAGUE.slug)})`,
    `delete from users where ${like("email")}`,
    `delete from login_codes where ${like("email")}`,
    `delete from account_invites where ${like("email")}`,
    `delete from league_admin_invites where ${like("email")}`,
    `delete from email_suppressions where ${like("email")}`,
    `delete from clubs where city = ${q(CITY.slug)} or slug in (${CLUBS.map((c) => q(c.slug)).join(", ")})`,
    `delete from cities where slug in (${q(CITY.slug)}, ${q(OTHER_CITY.slug)})`,
  ];
}

// The first Monday on or after 11 days from `now`, so round 1 starts about
// two weeks out.
export function firstRoundStart(now: Date): string {
  let day = addDays(budapestDay(now), 11);
  while (!isMonday(day)) day = addDays(day, 1);
  return day;
}

// The starting state. `now` is a parameter so tests can fix the dates.
export function insertStatements(now: Date): string[] {
  const today = budapestDay(now);
  const start = firstRoundStart(now);
  const phases = phaseCalendar(start, []);
  const opensAt = budapestTime(addDays(today, -1), 0, 0);
  const closesAt = budapestTime(addDays(start, -1), 23, 59);

  const out: string[] = [];
  out.push(`insert into cities (slug, name, listed) values (${q(CITY.slug)}, ${q(CITY.name)}, 1), (${q(OTHER_CITY.slug)}, ${q(OTHER_CITY.name)}, 1)`);
  for (const c of CLUBS)
    out.push(
      `insert into clubs (slug, city, name, active) values (${q(c.slug)}, ${q(CITY.slug)}, ${q(c.name)}, 1)`,
    );
  out.push(
    `insert into leagues (city, slug, name) values (${q(CITY.slug)}, ${q(LEAGUE.slug)}, ${q(LEAGUE.name)}), ` +
      `(${q(OTHER_CITY.slug)}, ${q(OTHER_LEAGUE.slug)}, ${q(OTHER_LEAGUE.name)})`,
  );

  // Admin and Szervező: finished accounts (name, level, sex and consent set), so
  // they log in with an email code and land on the app, not on /welcome. The
  // second league's player too, with a phone number like every new player.
  out.push(
    `insert into users (id, email, name, platform_role, level, sex, phone, consent_at) values ` +
      `(${q(ADMIN.id)}, ${q(ADMIN.email)}, ${q(ADMIN.name)}, 'superadmin', 'halado', 'male', NULL, ${secs(now)}), ` +
      `(${q(ORGANIZER.id)}, ${q(ORGANIZER.email)}, ${q(ORGANIZER.name)}, 'player', 'halado', 'female', NULL, ${secs(now)}), ` +
      `(${q(OUTSIDER.id)}, ${q(OUTSIDER.email)}, ${q(OUTSIDER.name)}, 'player', 'kozephalado', 'female', '+36301112233', ${secs(now)})`,
  );
  out.push(
    `insert into league_admins (league_id, user_id, granted_by) select id, ${q(ORGANIZER.id)}, ${q(ADMIN.id)} ` +
      `from leagues where slug = ${q(LEAGUE.slug)}`,
  );
  // Who belongs where (D128): the Admin and the Szervező joined Mintaváros,
  // like today's staff; Idegen Ilona joined Példaváros only, with "Párt
  // keresek" on there.
  const join = (userId: string, league: string) =>
    `insert into league_members (league_id, user_id, source) select id, ${q(userId)}, 'chosen' from leagues where slug = ${q(league)}`;
  out.push(join(ADMIN.id, LEAGUE.slug), join(ORGANIZER.id, LEAGUE.slug), join(OUTSIDER.id, OTHER_LEAGUE.slug));
  out.push(
    `insert into partner_searches (league_id, user_id, seeking) select id, ${q(OUTSIDER.id)}, 1 from leagues where slug = ${q(OTHER_LEAGUE.slug)}`,
  );

  out.push(
    `insert into seasons (league_id, name, registration_opens_at, registration_closes_at, first_phase_start, breaks) ` +
      `select id, ${q(SEASON_NAME)}, ${secs(opensAt)}, ${secs(closesAt)}, ${q(start)}, '[]' ` +
      `from leagues where slug = ${q(LEAGUE.slug)}`,
  );
  for (const p of phases)
    out.push(
      `insert into season_phases (season_id, number, starts_at, deadline) ` +
        `select s.id, ${p.number}, ${secs(p.startsAt)}, ${secs(p.deadline)} from seasons s ` +
        `join leagues l on l.id = s.league_id where l.slug = ${q(LEAGUE.slug)} and s.name = ${q(SEASON_NAME)}`,
    );
  return out;
}

// Reset, then write: the whole seed as one SQL file for `wrangler d1 execute --file`.
export function seedSql(now: Date): string {
  return [...resetStatements(), ...insertStatements(now)].map((s) => `${s};`).join("\n") + "\n";
}

// What the CLI prints when it is done.
export function summary(now: Date): string {
  const start = firstRoundStart(now);
  return [
    `Seeded ${CITY.name}: ${CLUBS.length} clubs, league "${LEAGUE.name}", season "${SEASON_NAME}" (round 1 starts ${start}).`,
    `And ${OTHER_CITY.name}: league "${OTHER_LEAGUE.name}" with one player (${OUTSIDER.email}).`,
    `Players register themselves: ${PAIR_PLAYERS.length * 2 + SOLO_PLAYERS.length} addresses in docs/walkthrough.md.`,
    `Admin: ${ADMIN.email}`,
    `Szervező: ${ORGANIZER.email}`,
    "Next: docs/walkthrough.md",
  ].join("\n");
}


// Fake data for walking through milestone 1 on a local database (#90,
// docs/walkthrough.md). Pure (no I/O): it builds SQL and decides whether a run
// is allowed; scripts/seed-local.ts runs it against the local D1 only.
//
// Everything it writes is recognisable and removable: addresses end in
// @example.test (a reserved domain, so mail to them goes nowhere), and the
// city, league and clubs have fixed slugs. Running it again first deletes all
// of that, including what a walkthrough created on top (pairs, entries,
// groups, held mail), then writes the same starting state again.

import { addDays, budapestDay, budapestTime, isMonday, phaseCalendar } from "@padel-liga/rules";

export const SEED_EMAIL_DOMAIN = "example.test";
export const CITY = { slug: "minta", name: "Mintaváros" } as const;
export const LEAGUE = { slug: "minta", name: "Padelpárbaj Mintaváros" } as const;
export const SEASON_NAME = "Teszt szezon";

export const ADMIN = { id: "seed-admin", email: `admin@${SEED_EMAIL_DOMAIN}`, name: "Teszt Admin" } as const;
export const ORGANIZER = { id: "seed-organizer", email: `szervezo@${SEED_EMAIL_DOMAIN}`, name: "Teszt Szervező" } as const;

export const CLUBS = [
  { slug: "minta-padel-arena", name: "Minta Padel Aréna" },
  { slug: "teszt-sportcentrum", name: "Teszt Sportcentrum" },
  { slug: "pelda-padel-club", name: "Példa Padel Club" },
] as const;

type Level = "kezdo" | "kozephalado" | "halado" | "versenyzo";
type Person = { name: string; email: string };

const person = (name: string, local: string): Person => ({ name, email: `${local}@${SEED_EMAIL_DOMAIN}` });

// Ten pair signups: both players named, so both get the registration invite.
// Each row shares one level, which prefills the first-login page of both.
export const PAIR_SIGNUPS: { a: Person; b: Person; level: Level }[] = [
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

// Four solo signups. The first two are already paired by a Szervező (they
// get the invite); the other two wait, so the walkthrough can pair them.
export const SOLO_SIGNUPS: { who: Person; level: Level; pairedWithNext: boolean }[] = [
  { who: person("Varga Dóra", "varga.dora"), level: "kozephalado", pairedWithNext: true },
  { who: person("Kiss Miklós", "kiss.miklos"), level: "kozephalado", pairedWithNext: false },
  { who: person("Pál Boglárka", "pal.boglarka"), level: "kezdo", pairedWithNext: false },
  { who: person("Sándor Ákos", "sandor.akos"), level: "halado", pairedWithNext: false },
];

// Every address the seed creates a signup for or an account with.
export function seedEmails(): string[] {
  return [
    ADMIN.email,
    ORGANIZER.email,
    ...PAIR_SIGNUPS.flatMap((p) => [p.a.email, p.b.email]),
    ...SOLO_SIGNUPS.map((s) => s.who.email),
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
const SEED_LEAGUE = `select id from leagues where slug = ${q(LEAGUE.slug)}`;
const like = (column: string): string => `lower(${column}) like '%@${SEED_EMAIL_DOMAIN}'`;

// Deletes the seed's rows and whatever hangs off them. The order follows the
// foreign keys: pairs have no cascade from users, so they go first; the
// league takes its seasons, entries, groups and matches with it.
export function resetStatements(): string[] {
  return [
    `delete from broadcasts where ${like("created_by")}`,
    `delete from email_messages where ${like("to_email")}`,
    `delete from pair_invites where league_id in (${SEED_LEAGUE}) or inviter_id in (${SEED_USERS}) or ${like("invitee_email")}`,
    `delete from pairs where league_id in (${SEED_LEAGUE}) or player_a in (${SEED_USERS}) or player_b in (${SEED_USERS})`,
    `delete from leagues where slug = ${q(LEAGUE.slug)}`,
    `delete from audit_log where actor_id in (${SEED_USERS}) or ${like("target")} or target = ${q(`league:${LEAGUE.slug}`)}`,
    `delete from users where ${like("email")}`,
    `delete from login_codes where ${like("email")}`,
    `delete from account_invites where ${like("email")}`,
    `delete from league_admin_invites where ${like("email")}`,
    `delete from email_suppressions where ${like("email")}`,
    `delete from interest_signups where ${like("email1")} or ${like("email2")}`,
    `delete from clubs where slug in (${CLUBS.map((c) => q(c.slug)).join(", ")})`,
    `delete from cities where slug = ${q(CITY.slug)}`,
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
  const hour = 3600 * 1000;
  // Signups arrive over the last ten days, in the order of the lists.
  let n = 0;
  const arrival = () => secs(new Date(now.getTime() - 10 * 24 * hour + n++ * 7 * hour));
  const consent = secs(new Date(now.getTime() - 11 * 24 * hour));

  const out: string[] = [];
  out.push(`insert into cities (slug, name, listed) values (${q(CITY.slug)}, ${q(CITY.name)}, 1)`);
  for (const c of CLUBS)
    out.push(
      `insert into clubs (slug, city, name, active) values (${q(c.slug)}, ${q(CITY.slug)}, ${q(c.name)}, 1)`,
    );
  out.push(`insert into leagues (city, slug, name) values (${q(CITY.slug)}, ${q(LEAGUE.slug)}, ${q(LEAGUE.name)})`);

  // Admin and Szervező: finished accounts (name, level and consent set), so
  // they log in with an email code and land on the app, not on /welcome.
  out.push(
    `insert into users (id, email, name, platform_role, level, consent_at) values ` +
      `(${q(ADMIN.id)}, ${q(ADMIN.email)}, ${q(ADMIN.name)}, 'superadmin', 'halado', ${secs(now)}), ` +
      `(${q(ORGANIZER.id)}, ${q(ORGANIZER.email)}, ${q(ORGANIZER.name)}, 'player', 'halado', ${secs(now)})`,
  );
  out.push(
    `insert into league_admins (league_id, user_id, granted_by) select id, ${q(ORGANIZER.id)}, ${q(ADMIN.id)} ` +
      `from leagues where slug = ${q(LEAGUE.slug)}`,
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

  const clubAt = (i: number) => CLUBS[i % CLUBS.length]!.slug;
  const signup = (cols: string, values: string) => `insert into interest_signups (${cols}) values (${values})`;
  const cols = "city, mode, name1, email1, name2, email2, level, ref, home_club, consent_at, status, created_at";
  PAIR_SIGNUPS.forEach((p, i) =>
    out.push(
      signup(
        cols,
        [
          q(CITY.slug), q("pair"), q(p.a.name), q(p.a.email), q(p.b.name), q(p.b.email), q(p.level),
          // Every third signup came from a club poster, as in real life.
          q(i % 3 === 0 ? clubAt(i) : null), q(clubAt(i)), consent, q("new"), arrival(),
        ].join(", "),
      ),
    ),
  );
  SOLO_SIGNUPS.forEach((s, i) =>
    out.push(
      signup(
        cols,
        [
          q(CITY.slug), q("solo"), q(s.who.name), q(s.who.email), "NULL", "NULL", q(s.level),
          "NULL", q(clubAt(i)), consent, q("new"), arrival(),
        ].join(", "),
      ),
    ),
  );
  // The Szervező's pairing of the first two solos: both rows point at each
  // other, as solo-pairing.server.ts writes them.
  const solos = SOLO_SIGNUPS.flatMap((s, i) => (s.pairedWithNext ? [[s.who, SOLO_SIGNUPS[i + 1]!.who] as const] : []));
  for (const [a, b] of solos)
    for (const [x, y] of [[a, b], [b, a]] as const)
      out.push(
        `update interest_signups set paired_with = (select id from interest_signups where email1 = ${q(y.email)}), ` +
          `status = 'paired' where email1 = ${q(x.email)}`,
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
  const solosPaired = SOLO_SIGNUPS.filter((s) => s.pairedWithNext).length * 2;
  return [
    `Seeded ${CITY.name}: ${CLUBS.length} clubs, league "${LEAGUE.name}", season "${SEASON_NAME}" (round 1 starts ${start}).`,
    `${PAIR_SIGNUPS.length} pair signups, ${SOLO_SIGNUPS.length} solo signups (${solosPaired} paired, ${SOLO_SIGNUPS.length - solosPaired} waiting).`,
    `Admin: ${ADMIN.email}`,
    `Szervező: ${ORGANIZER.email}`,
    "Next: docs/walkthrough.md",
  ].join("\n");
}

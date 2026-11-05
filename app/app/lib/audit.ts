// The audit log's vocabulary (#225, #226, D91): every action an organizer,
// the Admin, a script or the system can record, with the Hungarian name
// Napló shows. Pure; the writes are in audit.server.ts.

export const AUDIT_ACTIONS = {
  // Leagues and Szervezők
  "league.create": "Liga létrehozása",
  "league_admin.grant": "Szervező kinevezése",
  "league_admin.invite": "Szervező meghívása",
  "league_admin.revoke": "Szervező elvétele",
  "league_admin.invite_cancel": "Szervezői meghívó visszavonása",
  // Admin role and account invites (command line)
  "superadmin.grant": "Admin jog adása",
  "superadmin.revoke": "Admin jog elvétele",
  "account_invite.create": "Fiókmeghívó",
  // Cities and clubs
  "city.create": "Város létrehozása",
  "city.update": "Város módosítása",
  "city.delete": "Város törlése",
  "club.create": "Klub létrehozása",
  "club.update": "Klub módosítása",
  "club.activate": "Klub aktiválása",
  "club.deactivate": "Klub inaktiválása",
  "club.delete": "Klub törlése",
  // Seasons and groups
  "season.create": "Szezon létrehozása",
  "season.update": "Szezon módosítása",
  "season.delete": "Szezon törlése",
  "groups.draft": "Csoporttervezet",
  "groups.move": "Pár áthelyezése a tervezetben",
  "groups.publish": "Csoportok közzététele",
  // Pairs and entries
  "pair.create": "Pár létrehozása",
  "pair.dissolve": "Pár felbontása",
  "pair.change": "Partnercsere",
  "pair.link": "Pár párlinkkel",
  "season_entry.enter": "Benevezés",
  "season_entry.remove": "Kivétel a szezonból",
  "season_entry.withdraw": "Kivétel kihirdetett csoportból",
  "partner_search.on": "Párkeresés be",
  "partner_search.off": "Párkeresés ki",
  // Interest list
  "signup.update": "Jelentkezés módosítása",
  "signup.delete": "Jelentkezés törlése",
  "solo.pair": "Párkeresők összepárosítása",
  "solo.unpair": "Párosítás visszavonása",
  // Matches
  "match.decide": "Meccs eldöntése",
  "result.auto_accept": "Eredmény automatikus elfogadása",
  // Emails and reminders
  "broadcast.send": "Körlevél küldése",
  "registration_invites.send": "Regisztrációs meghívók",
  "reminders.on": "Emlékeztetők be",
  "reminders.off": "Emlékeztetők ki",
  // Accounts
  "account.delete": "Fiók törlése",
  "account.anonymize": "Fiók anonimizálása",
} as const;

export type AuditAction = keyof typeof AUDIT_ACTIONS;

// The Hungarian name; an unknown code (from an older version) as it is.
export function actionLabel(code: string): string {
  return Object.hasOwn(AUDIT_ACTIONS, code) ? AUDIT_ACTIONS[code as AuditAction] : code;
}

export const SYSTEM_ACTOR = "Rendszer";

// The actions written without an account: the cron and the command line.
// Any other entry without an actor lost it when its account was deleted.
export const SYSTEM_ACTIONS: readonly string[] = ["result.auto_accept", "superadmin.grant", "superadmin.revoke", "account_invite.create"];

export function isSystemAction(code: string): boolean {
  return SYSTEM_ACTIONS.includes(code);
}

// "pair:12" -> { kind: "pair", id: "12" }. Anything else (an older row's
// email address, say): kind null.
export function parseRef(ref: string): { kind: string | null; id: string } {
  const m = /^([a-z_]+):(.+)$/.exec(ref);
  return m ? { kind: m[1]!, id: m[2]! } : { kind: null, id: ref };
}

import { asc, eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { leagueAdmins, leagues, oauthAccounts, users } from "~/db/schema";

import { roleLabel, type RoleLabel } from "./auth/permissions";
import { statusChips, type StatusChip } from "./player-status";
import { playerStatuses } from "./player-status.server";
import { userFacts, type UserFacts } from "./users-filter";

// The Admin's user list (/admin/users). Never shown to anyone else: it has
// email addresses (CLAUDE.md: no contact details on public pages).
export type UserRow = {
  id: string;
  name: string;
  email: string;
  role: RoleLabel;
  leagues: string[];
  google: boolean;
  consent: boolean;
  // Registered, what's missing, pair and entry per league (player-status.ts).
  status: StatusChip[];
  // What the filters look at (users-filter.ts).
  facts: UserFacts;
  // Null when not asked for (only the Admin sees it) or never recorded.
  lastLoginAt: Date | null;
  createdAt: Date;
};

// `withLastLogin`: only for the Admin (the route checks the role).
export async function listUsers({ withLastLogin = false } = {}): Promise<UserRow[]> {
  const [rows, organized, google, statuses, leagueIds] = await Promise.all([
    db.select().from(users).orderBy(asc(users.name), asc(users.email)),
    db
      .select({ userId: leagueAdmins.userId, name: leagues.name, slug: leagues.slug, city: leagues.city, id: leagues.id })
      .from(leagueAdmins)
      .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId)),
    db.select({ userId: oauthAccounts.userId }).from(oauthAccounts),
    playerStatuses(),
    db.select({ id: leagues.id }).from(leagues),
  ]);
  const withGoogle = new Set(google.map((g) => g.userId));
  // The league name on the pair chip only when there is more than one league.
  const withLeague = leagueIds.length > 1;
  // Searched and filtered in JavaScript (search.ts, users-filter.ts), not in
  // SQL; hundreds of accounts at most.
  return rows.map((u) => {
    const mine = organized.filter((o) => o.userId === u.id);
    const status = statuses.byId.get(u.id);
    const role = roleLabel({ platformRole: u.platformRole, leagues: mine });
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role,
      leagues: mine.map((l) => l.name),
      google: withGoogle.has(u.id),
      consent: !!u.consentAt,
      status: statusChips(status, undefined, withLeague),
      facts: userFacts({ role, name: u.name, email: u.email }, status),
      lastLoginAt: withLastLogin ? u.lastLoginAt : null,
      createdAt: u.createdAt,
    };
  });
}

import { asc, eq, like, or } from "drizzle-orm";

import { db } from "~/db/client.server";
import { leagueAdmins, leagues, oauthAccounts, users } from "~/db/schema";

import { roleLabel, type RoleLabel } from "./auth/permissions";
import { statusChips, type StatusChip } from "./player-status";
import { playerStatuses } from "./player-status.server";

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
  // Null when not asked for (only the Admin sees it) or never recorded.
  lastLoginAt: Date | null;
  createdAt: Date;
};

// `withLastLogin`: only for the Admin (the route checks the role).
export async function listUsers(q: string, { withLastLogin = false } = {}): Promise<UserRow[]> {
  const term = q.trim().toLowerCase();
  const where = term ? or(like(users.email, `%${term}%`), like(users.name, `%${term}%`)) : undefined;
  const [rows, organized, google, statuses, leagueIds] = await Promise.all([
    db.select().from(users).where(where).orderBy(asc(users.name), asc(users.email)),
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
  return rows.map((u) => {
    const mine = organized.filter((o) => o.userId === u.id);
    const status = statuses.byId.get(u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: roleLabel({ platformRole: u.platformRole, leagues: mine }),
      leagues: mine.map((l) => l.name),
      google: withGoogle.has(u.id),
      consent: !!u.consentAt,
      status: statusChips(status, undefined, withLeague),
      lastLoginAt: withLastLogin ? u.lastLoginAt : null,
      createdAt: u.createdAt,
    };
  });
}

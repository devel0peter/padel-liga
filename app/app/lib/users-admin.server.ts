import { asc, eq, like, or } from "drizzle-orm";

import { db } from "~/db/client.server";
import { leagueAdmins, leagues, oauthAccounts, users } from "~/db/schema";

import { roleLabel, type RoleLabel } from "./auth/permissions";

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
  createdAt: Date;
};

export async function listUsers(q: string): Promise<UserRow[]> {
  const term = q.trim().toLowerCase();
  const where = term ? or(like(users.email, `%${term}%`), like(users.name, `%${term}%`)) : undefined;
  const [rows, organized, google] = await Promise.all([
    db.select().from(users).where(where).orderBy(asc(users.name), asc(users.email)),
    db
      .select({ userId: leagueAdmins.userId, name: leagues.name, slug: leagues.slug, city: leagues.city, id: leagues.id })
      .from(leagueAdmins)
      .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId)),
    db.select({ userId: oauthAccounts.userId }).from(oauthAccounts),
  ]);
  const withGoogle = new Set(google.map((g) => g.userId));
  return rows.map((u) => {
    const mine = organized.filter((o) => o.userId === u.id);
    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: roleLabel({ platformRole: u.platformRole, leagues: mine }),
      leagues: mine.map((l) => l.name),
      google: withGoogle.has(u.id),
      consent: !!u.consentAt,
      createdAt: u.createdAt,
    };
  });
}

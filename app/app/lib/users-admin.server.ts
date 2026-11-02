import { asc, eq, isNull } from "drizzle-orm";

import { db } from "~/db/client.server";
import { leagueAdmins, leagues, oauthAccounts, users } from "~/db/schema";

import { deletionPlan, DELETION_REFUSALS, type DeletionMode } from "./account-deletion";
import { deletionFacts } from "./account-deletion.server";
import { roleLabel, type RoleLabel } from "./auth/permissions";
import { statusChips, type StatusChip } from "./player-status";
import { playerStatuses } from "./player-status.server";
import { matchesSearch } from "./search";

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
  // "Törlés" (#152): what it would do, or why it can't be done; null when
  // not asked for.
  deletion: { mode: DeletionMode } | { refused: string } | null;
};

// `withLastLogin` and `deleteAs` (the Admin's id, for "Törlés"): only for the
// Admin (the route checks the role). Anonymized accounts (#152) aren't listed.
export async function listUsers(
  q: string,
  { withLastLogin = false, deleteAs = null }: { withLastLogin?: boolean; deleteAs?: string | null } = {},
): Promise<UserRow[]> {
  const [rows, organized, google, statuses, leagueIds, facts] = await Promise.all([
    db.select().from(users).where(isNull(users.deletedAt)).orderBy(asc(users.name), asc(users.email)),
    db
      .select({ userId: leagueAdmins.userId, name: leagues.name, slug: leagues.slug, city: leagues.city, id: leagues.id })
      .from(leagueAdmins)
      .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId)),
    db.select({ userId: oauthAccounts.userId }).from(oauthAccounts),
    playerStatuses(),
    db.select({ id: leagues.id }).from(leagues),
    deleteAs ? deletionFacts() : null,
  ]);
  const withGoogle = new Set(google.map((g) => g.userId));
  // The league name on the pair chip only when there is more than one league.
  const withLeague = leagueIds.length > 1;
  // Filtered here, not with LIKE (search.ts); hundreds of accounts at most.
  return rows.filter((u) => matchesSearch(q, [u.name, u.email])).map((u) => {
    const mine = organized.filter((o) => o.userId === u.id);
    const status = statuses.byId.get(u.id);
    const plan =
      deleteAs && facts
        ? deletionPlan({ actorId: deleteAs, target: u, history: facts.history.has(u.id), playing: facts.playing.has(u.id) })
        : null;
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
      deletion: plan && (plan.ok ? { mode: plan.mode } : { refused: DELETION_REFUSALS[plan.refusal] }),
    };
  });
}

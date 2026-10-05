import { data } from "react-router";
import { eq } from "drizzle-orm";

import { db } from "~/db/client.server";
import { leagueAdmins, leagues } from "~/db/schema";
import { requireAccess } from "~/lib/access.server";

import { can, type Actor, type Permission } from "./permissions";
import { getUser, requireUser, type User } from "./session.server";

// The one guard for admin pages: the admin layout's middleware calls it with
// "admin.enter", and every admin loader and action with its own permission,
// so a direct data request can't skip the check.

const cache = new WeakMap<Request, Promise<Actor>>();

async function loadActor(user: User): Promise<Actor> {
  const rows = await db
    .select({ id: leagues.id, slug: leagues.slug, city: leagues.city, name: leagues.name })
    .from(leagueAdmins)
    .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId))
    .where(eq(leagueAdmins.userId, user.id))
    .orderBy(leagues.name);
  return { id: user.id, email: user.email, name: user.name, platformRole: user.platformRole, leagues: rows };
}

function actorFor(request: Request, user: User): Promise<Actor> {
  let actor = cache.get(request);
  if (!actor) {
    actor = loadActor(user);
    cache.set(request, actor);
  }
  return actor;
}

// The logged-in actor, or null; for pages that only show links by role.
export async function getActor(request: Request): Promise<Actor | null> {
  const user = await getUser(request);
  return user ? actorFor(request, user) : null;
}

export async function requirePermission(request: Request, permission: Permission): Promise<Actor> {
  await requireAccess(request);
  const user = await requireUser(request);
  const actor = await actorFor(request, user);
  if (!can(actor, permission)) throw data({ forbidden: true }, { status: 403 });
  return actor;
}

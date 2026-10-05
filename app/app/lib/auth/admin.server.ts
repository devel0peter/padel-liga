import { data } from "react-router";

import { can, type Actor, type Permission } from "./permissions";
import { getSession, requireUser, type SessionData } from "./session.server";

// The one guard for admin pages: the admin layout's middleware calls it with
// "admin.enter", and every admin loader and action with its own permission,
// so a direct data request can't skip the check.

function toActor({ user, leagues }: SessionData): Actor {
  return { id: user.id, email: user.email, name: user.name, platformRole: user.platformRole, leagues };
}

// The logged-in actor, or null; for pages that only show links by role.
export async function getActor(request: Request): Promise<Actor | null> {
  const session = await getSession(request);
  return session ? toActor(session) : null;
}

export async function requirePermission(request: Request, permission: Permission): Promise<Actor> {
  await requireUser(request);
  const actor = toActor((await getSession(request))!);
  if (!can(actor, permission)) throw data({ forbidden: true }, { status: 403 });
  return actor;
}

import { Link, useRouteLoaderData } from "react-router";

import { can, type Actor } from "~/lib/auth/permissions";
import { adminProfilePath } from "~/lib/player-admin";
import { cn } from "~/lib/utils";

// A player's name on an admin page (#301): for the Admin a link to the
// player's profile (/admin/users/:id), for a Szervező plain text (the
// profile has the email address and the email log, D156). No id (a deleted
// account): plain text.
export function PersonLink({ id, name, className }: { id: string | null | undefined; name: string; className?: string }) {
  const actor = useRouteLoaderData<{ actor?: Actor }>("routes/app")?.actor ?? null;
  if (!id || !can(actor, { kind: "users.view" })) return <span className={className}>{name}</span>;
  return (
    <Link to={adminProfilePath(id)} className={cn("underline-offset-2 hover:underline", className)}>
      {name}
    </Link>
  );
}

import { Fragment } from "react";
import { Link, useRouteLoaderData } from "react-router";

import { DELETED_NAME } from "~/lib/account-deletion";
import { can, type Actor } from "~/lib/auth/permissions";
import { adminProfilePath } from "~/lib/player-admin";
import { cn } from "~/lib/utils";

// A player's name on an admin page (#301): for the Admin a link to the
// player's profile (/admin/users/:id), for a Szervező plain text (the
// profile has the email address and the email log, D156). No id, or an
// anonymized account ("Törölt játékos", which has no profile): plain text.
export function PersonLink({ id, name, className }: { id: string | null | undefined; name: string; className?: string }) {
  const actor = useRouteLoaderData<{ actor?: Actor }>("routes/app")?.actor ?? null;
  if (!id || name === DELETED_NAME || !can(actor, { kind: "users.view" })) return <span className={className}>{name}</span>;
  return (
    <Link to={adminProfilePath(id)} className={cn("underline-offset-2 hover:underline", className)}>
      {name}
    </Link>
  );
}

// A pair's two players, "Kiss Anna – Nagy Béla", each a PersonLink.
export function PairNames({ players }: { players: readonly { id: string | null; name: string }[] }) {
  return players.map((p, i) => (
    <Fragment key={p.id ?? i}>
      {i > 0 && " – "}
      <PersonLink id={p.id} name={p.name || "Névtelen"} />
    </Fragment>
  ));
}

import { redirect } from "react-router";

import type { Route } from "./+types/notification-open";
import { requireUser } from "~/lib/auth/session.server";
import { safeTarget } from "~/lib/notifications";
import { openNotification } from "~/lib/notifications.server";

// Every notification link (the list and the push) comes through here: mark
// it read, then go where it points.
export async function loader({ request, params }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const id = Number(params.id);
  const url = Number.isInteger(id) ? await openNotification(user.id, id) : null;
  throw redirect(url ? safeTarget(url) : "/notifications");
}

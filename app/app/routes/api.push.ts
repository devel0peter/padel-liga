import { data } from "react-router";

import type { Route } from "./+types/api.push";
import { requireUser } from "~/lib/auth/session.server";
import { parseSubscription } from "~/lib/notifications";
import { deleteSubscription, saveSubscription, sendTestNotification } from "~/lib/notifications.server";

// Push subscriptions of this browser, posted by the profile page
// (components/push-settings.tsx), and its "Próba" button.
export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const form = await request.formData();
  switch (form.get("intent")) {
    case "subscribe": {
      const sub = parseSubscription(form);
      if (!sub) return data({ error: "Ezt a böngészőt nem tudjuk értesíteni." }, { status: 400 });
      await saveSubscription(user.id, sub);
      return { ok: true };
    }
    case "unsubscribe": {
      const endpoint = form.get("endpoint");
      if (typeof endpoint === "string") await deleteSubscription(user.id, endpoint);
      return { ok: true };
    }
    case "test":
      return { ok: true, devices: await sendTestNotification(user.id) };
    default:
      return data({ error: "Ismeretlen kérés." }, { status: 400 });
  }
}

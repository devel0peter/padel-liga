import type { Route } from "./+types/match-contact";
import { requireUser } from "~/lib/auth/session.server";
import { isContactChannel } from "~/lib/matches";
import { recordContact } from "~/lib/matches.server";

// A tap on "SMS mindenkinek" or "E-mail mindenkinek" (D148), POSTed by the
// page in the background while the link opens the phone's SMS or mail app:
// it goes into the match log as an attempt to schedule. The answer is always
// empty; whether it was logged (once per pair per Budapest day, only while
// the match can still be scheduled) is matches.server.ts recordContact's.
export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  const user = await requireUser(request);
  const id = Number(params.id);
  const channel = (await request.formData()).get("channel");
  if (!Number.isInteger(id) || id <= 0 || !isContactChannel(channel)) return new Response(null, { status: 400 });
  await recordContact(user.id, id, channel);
  return new Response(null, { status: 204 });
}

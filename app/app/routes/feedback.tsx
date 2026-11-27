import { Link, useNavigation } from "react-router";

import type { Route } from "./+types/feedback";
import { AuthPage } from "~/components/auth";
import { FEEDBACK_INTRO, FeedbackFields, THANKS_TEXT, THANKS_TITLE, type FeedbackAnswer } from "~/components/feedback-form";
import { Button } from "~/components/ui/button";
import { APP_VERSION } from "~/lib/app-version";
import { safeReturnTo } from "~/lib/auth/rules";
import { getUser } from "~/lib/auth/session.server";
import { browserFamily, DEVICE_LABELS, deviceClass, pagePath } from "~/lib/feedback";
import { submitFeedback } from "~/lib/feedback.server";
import { formatDateTime } from "~/lib/format";
import { SITE_NAME } from "~/lib/site";
import { turnstileSiteKey } from "~/lib/turnstile.server";

// Visszajelzés (#240, spec 19, D94): anyone sends a bug report, an idea or
// something else from any page. The page it was opened from comes in
// ?from=; the context sent along is listed above the button. Visitors pass
// the signup's bot check (Turnstile). Nothing is mailed or notified.

export function meta({}: Route.MetaArgs) {
  return [{ title: `Visszajelzés – ${SITE_NAME}` }, { name: "robots", content: "noindex" }];
}

export async function loader({ request }: Route.LoaderArgs) {
  const from = new URL(request.url).searchParams.get("from");
  const user = await getUser(request);
  const userAgent = request.headers.get("User-Agent");
  return {
    from: from ?? "",
    // The link on the thank-you: the page itself, query string and all, if
    // it is one of ours; else the start page.
    back: from && safeReturnTo(from) === from ? from : user ? "/home" : "/",
    page: pagePath(from),
    sentAt: formatDateTime(new Date()),
    device: DEVICE_LABELS[deviceClass(userAgent)],
    browser: browserFamily(userAgent),
    version: APP_VERSION,
    account: user ? user.name || "a fiókod" : null,
    // Logged in: no bot check.
    turnstileSiteKey: user ? null : turnstileSiteKey(),
  };
}

export async function action({ request }: Route.ActionArgs): Promise<FeedbackAnswer> {
  const form = await request.formData();
  const user = await getUser(request);
  const result = await submitFeedback(form, request, user?.id ?? null);
  if (result.ok) return result;
  return { ok: false, error: result.error, kind: String(form.get("kind") ?? ""), message: String(form.get("message") ?? "") };
}

// The page itself: old links and a browser without JavaScript. The sidebar
// and the public footer open the same form in a dialog (#444).
export default function Feedback({ loaderData, actionData }: Route.ComponentProps) {
  const busy = useNavigation().state !== "idle";
  if (actionData?.ok) {
    return (
      <AuthPage title={THANKS_TITLE} intro={THANKS_TEXT}>
        <Button asChild size="xl">
          <Link to={loaderData.back}>Vissza oda, ahonnan jöttél</Link>
        </Button>
      </AuthPage>
    );
  }
  return (
    <AuthPage title="Visszajelzés" intro={FEEDBACK_INTRO}>
      <FeedbackFields data={loaderData} failed={actionData && !actionData.ok ? actionData : null} busy={busy} answer={actionData} />
    </AuthPage>
  );
}

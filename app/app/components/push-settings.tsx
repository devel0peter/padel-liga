import { useFetcher } from "react-router";

import { usePushDevice } from "~/components/use-push-device";
import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { CHANNELS } from "~/lib/notifications";
import { PUSH_NOTICES } from "~/lib/push/device";

// The push switch of the profile (#115) and this device's subscription.
// The switch is per account (on by default; saved by the profile action):
// off, no device gets a push. Turning it on also asks this browser for
// permission and subscribes it (usePushDevice, shared with the Kezdőlap's
// push tip, #262).

const IPHONE =
  "iPhone-on iOS 16.4 vagy újabb kell, és a Padelpárbajt a főképernyőhöz kell adnod (Safariban Megosztás → Főképernyőhöz adás), aztán onnan megnyitnod.";

export function PushSettings({ vapidPublicKey, enabled }: { vapidPublicKey: string | null; enabled: boolean }) {
  const { state, error, busy, subscribe: subscribeDevice, unsubscribe: unsubscribeDevice } = usePushDevice(vapidPublicKey);
  const channel = useFetcher();
  const test = useFetcher<{ ok?: true; devices?: number; error?: string }>();

  // Optimistic: show the new value while it saves.
  const pending = channel.formData?.get("enabled");
  const on = pending != null ? pending === "1" : enabled;

  function toggle(next: boolean) {
    channel.submit({ intent: "channel", channel: "push", enabled: next ? "1" : "0" }, { method: "post", action: "/profile" });
    if (next && state === "off") void subscribeDevice();
  }

  const notice = PUSH_NOTICES;

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <Switch id="channel-push" checked={on} disabled={busy || state === "checking"} onCheckedChange={toggle} className="mt-0.5" />
        <div className="grid gap-0.5">
          <Label htmlFor="channel-push">{CHANNELS.push.label}</Label>
          <p className="text-sm text-muted-foreground">{CHANNELS.push.description}</p>
          <p className="text-sm text-muted-foreground">{IPHONE}</p>
        </div>
      </div>
      <div className="grid gap-3 pl-11">
        {!on ? (
          <p className="text-sm text-muted-foreground">Kikapcsolva: egy eszközödre sem küldünk push értesítést.</p>
        ) : !vapidPublicKey ? (
          <p className="text-sm text-muted-foreground">A push értesítés még nincs beállítva.</p>
        ) : (
          <>
            {state === "on" && (
              <>
                <p className="text-sm text-muted-foreground">
                  Ezen az eszközön be van kapcsolva. A többi eszközödön ott kell bekapcsolni.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  <test.Form method="post" action="/api/push">
                    <Button type="submit" name="intent" value="test" variant="outline" size="sm" disabled={test.state !== "idle"}>
                      Próba értesítés
                    </Button>
                  </test.Form>
                  <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={unsubscribeDevice}>
                    Kikapcsolom ezen az eszközön
                  </Button>
                  {test.data?.devices !== undefined && (
                    <span className="text-sm text-muted-foreground">
                      {test.data.devices > 0
                        ? `Elküldtük ${test.data.devices} eszközre.`
                        : "Egy eszközre sem ment ki. Kapcsold ki és be újra ezen az eszközön."}
                    </span>
                  )}
                </div>
              </>
            )}
            {state === "off" && (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-muted-foreground">Ezen az eszközön még nincs bekapcsolva.</p>
                <Button type="button" variant="outline" size="sm" disabled={busy} onClick={subscribeDevice}>
                  Bekapcsolom ezen az eszközön
                </Button>
              </div>
            )}
            {notice[state] && <p className="text-sm text-muted-foreground">{notice[state]}</p>}
          </>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}

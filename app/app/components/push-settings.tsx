import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { CHANNELS } from "~/lib/notifications";
import { fromBase64Url } from "~/lib/push/webpush";

// The push switch of the profile (#115) and this device's subscription.
// The switch is per account (on by default; saved by the profile action):
// off, no device gets a push. Turning it on also asks this browser for
// permission and subscribes it (stored via /api/push). Everything about the
// device runs in the browser; the server render shows a neutral state until
// the checks are done.

type State =
  | "checking"
  | "unsupported"
  // iPhone/iPad in Safari: push works only from the home screen app.
  | "ios-browser"
  | "denied"
  | "off"
  | "on";

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js");
}

const IPHONE =
  "iPhone-on iOS 16.4 vagy újabb kell, és a Padelpárbajt a főképernyőhöz kell adnod (Safariban Megosztás → Főképernyőhöz adás), aztán onnan megnyitnod.";

export function PushSettings({ vapidPublicKey, enabled }: { vapidPublicKey: string | null; enabled: boolean }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const channel = useFetcher();
  const save = useFetcher<{ ok?: true; error?: string }>();
  const test = useFetcher<{ ok?: true; devices?: number; error?: string }>();

  // Optimistic: show the new value while it saves.
  const pending = channel.formData?.get("enabled");
  const on = pending != null ? pending === "1" : enabled;

  function post(fetcher: typeof save, sub: PushSubscription | null, intent: string) {
    const keys = sub?.toJSON().keys;
    fetcher.submit(
      { intent, endpoint: sub?.endpoint ?? "", p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" },
      { method: "post", action: "/api/push" },
    );
  }

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(isIos() && !isStandalone() ? "ios-browser" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setState("denied");
      const sub = await (await registration()).pushManager.getSubscription();
      // Re-send an existing subscription, in case the server forgot it.
      if (sub) post(save, sub, "subscribe");
      setState(sub ? "on" : "off");
    })().catch(() => setState("unsupported"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (save.data?.error) setError(save.data.error);
  }, [save.data]);

  async function subscribeDevice() {
    if (!vapidPublicKey) return;
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const reg = await registration();
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromBase64Url(vapidPublicKey) });
      post(save, sub, "subscribe");
      setState("on");
    } catch {
      setError("Nem sikerült bekapcsolni. Próbáld újra.");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribeDevice() {
    setBusy(true);
    setError(null);
    try {
      const sub = await (await registration()).pushManager.getSubscription();
      if (sub) {
        post(save, sub, "unsubscribe");
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  function toggle(next: boolean) {
    channel.submit({ intent: "channel", channel: "push", enabled: next ? "1" : "0" }, { method: "post", action: "/profile" });
    if (next && state === "off") void subscribeDevice();
  }

  const notice: Partial<Record<State, string>> = {
    unsupported: "Ez a böngésző nem tud értesítést küldeni. Próbáld Chrome-mal, Firefoxszal vagy Safarival.",
    "ios-browser": "Böngészőből ezen az iPhone-on nem megy: add a főképernyőhöz, nyisd meg onnan, és ott kapcsold be.",
    denied: "Ebben a böngészőben letiltottad az értesítéseket. A böngésző beállításaiban engedélyezheted a padelparbaj.hu-nak, aztán töltsd újra az oldalt.",
  };

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

import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "~/components/ui/button";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { fromBase64Url } from "~/lib/push/webpush";

// Web push on this device: subscribe or unsubscribe this browser (stored via
// /api/push), and send a test. Everything here runs in the browser; the
// server render shows a neutral state until the checks are done.

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

export function PushSettings({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [state, setState] = useState<State>("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useFetcher<{ ok?: true; error?: string }>();
  const test = useFetcher<{ ok?: true; devices?: number; error?: string }>();

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

  async function turnOn() {
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

  async function turnOff() {
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

  if (!vapidPublicKey) return <p className="text-sm text-muted-foreground">A telefonos értesítés még nincs beállítva.</p>;

  const notice: Partial<Record<State, string>> = {
    unsupported: "Ez a böngésző nem tud értesítést küldeni. Próbáld Chrome-mal, Firefoxszal vagy Safarival.",
    "ios-browser":
      "iPhone-on akkor kapsz értesítést, ha a Padelpárbajt a főképernyőről nyitod meg (iOS 16.4 vagy újabb kell): Safariban Megosztás → Főképernyőhöz adás, aztán nyisd meg onnan, és itt kapcsold be.",
    denied: "Ebben a böngészőben letiltottad az értesítéseket. A böngésző beállításaiban engedélyezheted a padelparbaj.hu-nak, aztán töltsd újra az oldalt.",
  };

  return (
    <div className="grid gap-3">
      <div className="flex items-start gap-3">
        <Switch
          id="push-device"
          checked={state === "on"}
          disabled={busy || (state !== "on" && state !== "off")}
          onCheckedChange={(on) => (on ? turnOn() : turnOff())}
          className="mt-0.5"
        />
        <div className="grid gap-0.5">
          <Label htmlFor="push-device">Értesítés ezen az eszközön</Label>
          <p className="text-sm text-muted-foreground">
            {state === "on" ? "Bekapcsolva. A többi eszközödön külön kell bekapcsolni." : "Push értesítés a telefonodra vagy a gépedre, akkor is, ha nincs nyitva az oldal."}
          </p>
        </div>
      </div>
      {notice[state] && <p className="text-sm text-muted-foreground">{notice[state]}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {state === "on" && (
        <div className="flex flex-wrap items-center gap-3">
          <test.Form method="post" action="/api/push">
            <Button type="submit" name="intent" value="test" variant="outline" size="sm" disabled={test.state !== "idle"}>
              Próba értesítés
            </Button>
          </test.Form>
          {test.data?.devices !== undefined && (
            <span className="text-sm text-muted-foreground">
              {test.data.devices > 0 ? `Elküldtük ${test.data.devices} eszközre.` : "Egy eszközre sem ment ki. Kapcsold ki és be újra."}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

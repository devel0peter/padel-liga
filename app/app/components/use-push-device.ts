import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { pushDeviceState, type PushDeviceState } from "~/lib/push/device";
import { fromBase64Url } from "~/lib/push/webpush";

// This device's push subscription (#115): the browser checks, asking for
// permission, subscribing and unsubscribing (stored via /api/push). The one
// place that does it, for the profile's push switch (push-settings.tsx) and
// the Kezdőlap's push tip (#262). Everything runs in the browser; the server
// render shows "checking" until the checks are done.

function isIos() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
}

async function registration() {
  return navigator.serviceWorker.register("/sw.js");
}

/**
 * `resync`: re-send an existing subscription on load, in case the server
 * forgot it (the profile does; the tip doesn't need to).
 */
export function usePushDevice(vapidPublicKey: string | null, { resync = true }: { resync?: boolean } = {}) {
  const [state, setState] = useState<PushDeviceState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useFetcher<{ ok?: true; error?: string }>();

  function post(sub: PushSubscription | null, intent: string) {
    const keys = sub?.toJSON().keys;
    save.submit(
      { intent, endpoint: sub?.endpoint ?? "", p256dh: keys?.p256dh ?? "", auth: keys?.auth ?? "" },
      { method: "post", action: "/api/push" },
    );
  }

  useEffect(() => {
    (async () => {
      const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      const env = { supported, ios: isIos(), standalone: isStandalone(), permission: supported ? Notification.permission : "default", subscribed: false };
      if (!supported || env.permission === "denied") return setState(pushDeviceState(env));
      const sub = await (await registration()).pushManager.getSubscription();
      if (sub && resync) post(sub, "subscribe");
      setState(pushDeviceState({ ...env, subscribed: !!sub }));
    })().catch(() => setState("unsupported"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (save.data?.error) setError(save.data.error);
  }, [save.data]);

  async function subscribe() {
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
      post(sub, "subscribe");
      setState("on");
    } catch {
      setError("Nem sikerült bekapcsolni. Próbáld újra.");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe() {
    setBusy(true);
    setError(null);
    try {
      const sub = await (await registration()).pushManager.getSubscription();
      if (sub) {
        post(sub, "unsubscribe");
        await sub.unsubscribe();
      }
      setState("off");
    } finally {
      setBusy(false);
    }
  }

  return { state, error, busy, subscribe, unsubscribe };
}

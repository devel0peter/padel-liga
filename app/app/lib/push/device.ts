// What this browser can do about push, from what it reports (pure; the
// browser checks are in components/use-push-device.ts). Shared by the
// profile's push switch (#115) and the Kezdőlap's push tip (#262).

export type PushDeviceState =
  | "checking"
  | "unsupported"
  // iPhone/iPad in Safari: push works only from the home screen app.
  | "ios-browser"
  | "denied"
  | "off"
  | "on";

export type PushEnvironment = {
  // The browser has a service worker, PushManager and Notification.
  supported: boolean;
  ios: boolean;
  // Opened from the home screen (installed app).
  standalone: boolean;
  permission: "default" | "denied" | "granted";
  // This device has a push subscription.
  subscribed: boolean;
};

export function pushDeviceState(e: PushEnvironment): Exclude<PushDeviceState, "checking"> {
  if (!e.supported) return e.ios && !e.standalone ? "ios-browser" : "unsupported";
  if (e.permission === "denied") return "denied";
  return e.subscribed ? "on" : "off";
}

// What the profile and the tip say instead of a button, by state.
export const PUSH_NOTICES: Partial<Record<PushDeviceState, string>> = {
  unsupported: "Ez a böngésző nem tud értesítést küldeni. Próbáld Chrome-mal, Firefoxszal vagy Safarival.",
  "ios-browser": "Böngészőből ezen az iPhone-on nem megy: add a főképernyőhöz, nyisd meg onnan, és ott kapcsold be.",
  denied: "Ebben a böngészőben letiltottad az értesítéseket. A böngésző beállításaiban engedélyezheted a padelparbaj.hu-nak, aztán töltsd újra az oldalt.",
};

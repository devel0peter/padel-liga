// This browser's push state (#115, #262): the profile's switch and the
// Kezdőlap's push tip read it the same way.
import { describe, expect, it } from "vitest";

import { PUSH_NOTICES, pushDeviceState, type PushEnvironment } from "./device";

const desktop: PushEnvironment = { supported: true, ios: false, standalone: false, permission: "default", subscribed: false };

describe("pushDeviceState", () => {
  it("a browser that can push: off until this device subscribes", () => {
    expect(pushDeviceState(desktop)).toBe("off");
    expect(pushDeviceState({ ...desktop, permission: "granted", subscribed: true })).toBe("on");
  });

  it("blocked notifications: denied, even with an old subscription", () => {
    expect(pushDeviceState({ ...desktop, permission: "denied" })).toBe("denied");
    expect(pushDeviceState({ ...desktop, permission: "denied", subscribed: true })).toBe("denied");
  });

  it("no push in the browser: unsupported; an iPhone in Safari: add it to the home screen", () => {
    expect(pushDeviceState({ ...desktop, supported: false })).toBe("unsupported");
    expect(pushDeviceState({ ...desktop, supported: false, ios: true })).toBe("ios-browser");
    expect(pushDeviceState({ ...desktop, supported: false, ios: true, standalone: true })).toBe("unsupported");
  });

  it("says how to allow a blocked browser instead of asking again", () => {
    expect(PUSH_NOTICES.denied).toContain("beállításaiban engedélyezheted");
    expect(PUSH_NOTICES.off).toBeUndefined();
    expect(PUSH_NOTICES.on).toBeUndefined();
  });
});

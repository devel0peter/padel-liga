import { describe, expect, it } from "vitest";

import {
  isEnabled,
  kindsFor,
  newSignupMessage,
  parseSubscription,
  pushPayload,
  safeTarget,
  signupRecipients,
  timeAgo,
  type SignupSummary,
} from "./notifications";

const gyor = { id: 1, slug: "gyor", city: "gyor", name: "Padelpárbaj Győr" };

describe("kindsFor", () => {
  it("offers new signups to Szervezők and Admins only", () => {
    expect(kindsFor({ platformRole: "player", leagues: [] })).toEqual([]);
    expect(kindsFor({ platformRole: "player", leagues: [gyor] })).toEqual(["new_signup"]);
    expect(kindsFor({ platformRole: "superadmin", leagues: [] })).toEqual(["new_signup"]);
  });
});

describe("isEnabled", () => {
  it("is on until switched off; the test kind is always on", () => {
    expect(isEnabled(new Set(), "new_signup")).toBe(true);
    expect(isEnabled(new Set(["new_signup"]), "new_signup")).toBe(false);
    expect(isEnabled(new Set(["test"]), "test")).toBe(true);
  });
});

describe("signupRecipients", () => {
  const organizers = [
    { userId: "anna", city: "gyor", leagueSlug: "gyor" },
    { userId: "bela", city: "pecs", leagueSlug: "pecs" },
    { userId: "peter", city: "gyor", leagueSlug: "gyor" },
  ];

  it("sends to the city's Szervezők and every Admin, once each", () => {
    expect(signupRecipients("gyor", organizers, ["peter"])).toEqual([
      { userId: "peter", admin: true, leagueSlug: null },
      { userId: "anna", admin: false, leagueSlug: "gyor" },
    ]);
  });

  it("sends a city without a league to the Admins only", () => {
    expect(signupRecipients("other", organizers, ["peter"])).toEqual([{ userId: "peter", admin: true, leagueSlug: null }]);
    expect(signupRecipients("other", organizers, [])).toEqual([]);
  });
});

describe("newSignupMessage", () => {
  const pair: SignupSummary = { mode: "pair", level: "halado", cityName: "Győr", pairs: 9, solos: 4 };
  const organizer = { userId: "anna", admin: false, leagueSlug: "gyor" };
  const admin = { userId: "peter", admin: true, leagueSlug: null };

  it("names the city, the level and the counts, never the people", () => {
    expect(newSignupMessage(pair, organizer)).toEqual({
      title: "Új jelentkező · Győr",
      body: "Új pár jelentkezett, haladó szint. Eddig 9 pár és 4 egyéni jelentkező.",
      url: "/admin/leagues/gyor",
    });
  });

  it("sends a Szervező to the solo list for a solo signup", () => {
    const m = newSignupMessage({ ...pair, mode: "solo", level: "kezdo" }, organizer);
    expect(m.body).toBe("Új egyéni jelentkező (párt keres), kezdő szint. Eddig 9 pár és 4 egyéni jelentkező.");
    expect(m.url).toBe("/admin/leagues/gyor/solos");
  });

  it("sends an Admin to the signup list", () => {
    expect(newSignupMessage(pair, admin).url).toBe("/admin/signups");
  });
});

describe("pushPayload", () => {
  it("opens the notification through its read-marking link", () => {
    expect(pushPayload(42, { title: "T", body: "B", url: "/admin/signups" })).toEqual({
      title: "T",
      body: "B",
      url: "/notifications/42",
      tag: "n42",
    });
  });
});

describe("safeTarget", () => {
  it("keeps paths on this site and drops anything else", () => {
    expect(safeTarget("/admin/signups")).toBe("/admin/signups");
    expect(safeTarget("//evil.example")).toBe("/notifications");
    expect(safeTarget("https://evil.example")).toBe("/notifications");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms), now, () => "okt. 1.");
  const min = 60_000;

  it("counts minutes, hours and days, then shows the date", () => {
    expect(ago(30_000)).toBe("most");
    expect(ago(5 * min)).toBe("5 perce");
    expect(ago(3 * 60 * min)).toBe("3 órája");
    expect(ago(25 * 60 * min)).toBe("tegnap");
    expect(ago(4 * 24 * 60 * min)).toBe("4 napja");
    expect(ago(8 * 24 * 60 * min)).toBe("okt. 1.");
  });
});

describe("parseSubscription", () => {
  const p256dh = "B".padEnd(87, "a");
  const auth = "c".repeat(22);
  const form = (endpoint: string, extra: Record<string, string> = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ endpoint, p256dh, auth, ...extra })) f.set(k, v);
    return f;
  };

  it("accepts the browsers' push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QAbc",
    ])
      expect(parseSubscription(form(endpoint))).toEqual({ endpoint, p256dh, auth });
  });

  it("refuses any other address, so the server can't be made to call it", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/x",
      "https://evilpush.apple.com.example/x",
      "https://localhost/x",
      "nem url",
    ])
      expect(parseSubscription(form(endpoint))).toBeNull();
  });

  it("refuses malformed keys", () => {
    expect(parseSubscription(form("https://fcm.googleapis.com/x", { p256dh: "short" }))).toBeNull();
    expect(parseSubscription(form("https://fcm.googleapis.com/x", { auth: "c".repeat(21) + "=" }))).toBeNull();
  });
});

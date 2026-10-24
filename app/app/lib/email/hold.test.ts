import { describe, expect, it } from "vitest";

import { emailMessages } from "~/db/schema";
import { inviteLink } from "~/lib/pairs";
import { CONTACT_EMAIL, SITE_URL } from "~/lib/site";

import { AUTOMATIC_KINDS, HIDDEN, hideAddresses, isAutomatic, kindLabel, parseKind, queuedStatus } from "./hold";
import { pairIntro, pairInvite, registrationInvite } from "./templates";
import { unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

const ALL_KINDS = emailMessages.kind.enumValues;

describe("queuedStatus", () => {
  it("lets only login codes and signup confirmations go out by themselves", () => {
    expect(AUTOMATIC_KINDS).toEqual(["login_code", "signup_confirmation"]);
    expect(queuedStatus("login_code")).toBe("pending");
    expect(queuedStatus("signup_confirmation")).toBe("pending");
  });

  it("holds every other kind in the schema", () => {
    const others = ALL_KINDS.filter((k) => k !== "login_code" && k !== "signup_confirmation");
    expect(others.length).toBeGreaterThan(0);
    for (const kind of others) expect(queuedStatus(kind), kind).toBe("held");
  });

  it("holds the group publish emails (#24) and a kind it has never heard of (allowlist)", () => {
    expect(ALL_KINDS).toContain("groups_published");
    expect(queuedStatus("groups_published")).toBe("held");
    expect(isAutomatic("anything_new")).toBe(false);
  });
});

describe("kindLabel", () => {
  it("names every kind in Hungarian, and falls back to the code name for a new one", () => {
    for (const kind of ALL_KINDS) expect(kindLabel(kind), kind).not.toBe(kind);
    expect(kindLabel("anything_new")).toBe("anything_new");
  });
});

describe("parseKind", () => {
  it("accepts a known kind only", () => {
    expect(parseKind("pair_answer")).toBe("pair_answer");
    for (const v of [null, "", "nope", "pair_answer ", new File([], "x")]) expect(parseKind(v)).toBeNull();
  });
});

describe("hideAddresses", () => {
  const leak = (text: string, email: string) => {
    const lower = email.toLowerCase();
    const b64 = btoa(lower).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return [lower, encodeURIComponent(lower), b64].filter((s) => text.toLowerCase().includes(s.toLowerCase()));
  };

  it("hides plain addresses, but keeps our contact address", () => {
    expect(hideAddresses(`Írj neki: anna.nagy+liga@example.com. Kapcsolat: ${CONTACT_EMAIL}`)).toBe(
      `Írj neki: ${HIDDEN}. Kapcsolat: ${CONTACT_EMAIL}`,
    );
  });

  it("hides the partner's address in a pair intro", () => {
    const { text, subject } = pairIntro(
      { name: "Anna", email: "anna@example.com", level: "kezdo" },
      { name: "Béla", email: "Bela.Kovacs@example.hu", level: "halado" },
      "Győr",
    );
    expect(leak(hideAddresses(text), "bela.kovacs@example.hu")).toEqual([]);
    expect(leak(hideAddresses(text), "anna@example.com")).toEqual([]);
    expect(hideAddresses(text)).toContain(`Az e-mail-címe: ${HIDDEN}`);
    expect(hideAddresses(subject)).toBe(subject);
  });

  it("hides the address in a login link and in the unsubscribe link", async () => {
    const email = "zsofi.szabo@example.com";
    const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(email, "secret"));
    const { text } = registrationInvite({ name: "Zsófi", email }, url);
    expect(leak(text, email).length).toBeGreaterThan(0);
    const hidden = hideAddresses(text);
    expect(leak(hidden, email)).toEqual([]);
    expect(hidden).toContain(`${SITE_URL}/login?email=${HIDDEN}`);
    expect(hidden).toContain(`?t=${HIDDEN}`);
  });

  it("hides the invitee's address in a pair invite for someone without an account", async () => {
    const email = "uj.jatekos@example.com";
    const link = inviteLink(SITE_URL, "a".repeat(43), { email, hasAccount: false });
    const url = unsubscribeUrl(SITE_URL, await unsubscribeToken(email, "secret"));
    const { text } = pairInvite({ inviterName: "Anna", league: "Padelpárbaj Győr", link, hasAccount: false }, url);
    expect(leak(hideAddresses(text), email)).toEqual([]);
    expect(hideAddresses(text)).toContain(CONTACT_EMAIL);
  });

  it("hides a percent-encoded address outside a link parameter", () => {
    expect(hideAddresses("cím: anna%40example.com vége")).toBe(`cím: ${HIDDEN} vége`);
  });
});

import { describe, expect, it } from "vitest";

import { emailMessages } from "~/db/schema";
import { CONTACT_EMAIL, SITE_URL } from "~/lib/site";

import { HIDDEN, hideAddresses, kindLabel, relayWarning } from "./outbox-view";
import { pairIntro, registrationInvite } from "./templates";
import { unsubscribeToken, unsubscribeUrl } from "./unsubscribe";

const ALL_KINDS = emailMessages.kind.enumValues;

describe("kindLabel", () => {
  it("names every kind in Hungarian, and falls back to the code name for a new one", () => {
    for (const kind of ALL_KINDS) expect(kindLabel(kind), kind).not.toBe(kind);
    expect(kindLabel("anything_new")).toBe("anything_new");
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

  it("hides the recipient in an SMTP refusal (#112: the log shows failure reasons)", () => {
    expect(
      hideAddresses("relay: RCPT TO: 550 5.1.1 The email account <bela.kovacs@example.hu> does not exist; resend: 422 x"),
    ).toBe(`relay: RCPT TO: 550 5.1.1 The email account <${HIDDEN}> does not exist; resend: 422 x`);
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

  it("hides a percent-encoded address outside a link parameter", () => {
    expect(hideAddresses("cím: anna%40example.com vége")).toBe(`cím: ${HIDDEN} vége`);
  });
});

describe("relayWarning (#127)", () => {
  it("warns in production when the relay is missing, in Hungarian and with no secret or address", () => {
    const text = relayWarning(false, false);
    expect(text).toMatch(/Resend/);
    expect(text).toMatch(/100/);
    expect(text).not.toMatch(/@/);
  });

  it("is silent when the relay is configured", () => {
    expect(relayWarning(true, false)).toBeNull();
  });

  it("is silent in local dev, where the console shows the emails", () => {
    expect(relayWarning(false, true)).toBeNull();
  });
});

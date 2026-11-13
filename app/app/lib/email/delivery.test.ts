import { describe, expect, it } from "vitest";

import { commsStatus, deliveryFromEvent, nextDelivery, sentVia, shownSubject, suppressionNote, type Delivery } from "./delivery";

const NOW = new Date("2026-11-11T10:00:00Z");
const event = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  created_at: "2026-11-10T08:30:00.000Z",
  data: { email_id: "re_123", to: ["anna@x.hu"], ...extra },
});

describe("deliveryFromEvent (#242)", () => {
  it("reads delivered, a permanent and a temporary bounce, and a complaint, with the event's time", () => {
    const at = new Date("2026-11-10T08:30:00.000Z");
    expect(deliveryFromEvent(event("email.delivered"), NOW)).toEqual({ providerId: "re_123", delivery: "delivered", at });
    expect(deliveryFromEvent(event("email.bounced", { bounce: { type: "Permanent" } }), NOW)?.delivery).toBe("bounced");
    expect(deliveryFromEvent(event("email.bounced", { bounce: { type: "Transient" } }), NOW)?.delivery).toBe("soft_bounced");
    expect(deliveryFromEvent(event("email.bounced"), NOW)?.delivery).toBe("soft_bounced");
    expect(deliveryFromEvent(event("email.complained"), NOW)?.delivery).toBe("complained");
  });

  it("ignores other events and events without an email id; a bad time is now", () => {
    expect(deliveryFromEvent(event("email.sent"), NOW)).toBeNull();
    expect(deliveryFromEvent(event("email.opened"), NOW)).toBeNull();
    expect(deliveryFromEvent({ type: "email.delivered", data: {} }, NOW)).toBeNull();
    expect(deliveryFromEvent({ ...event("email.delivered"), created_at: "tegnap" }, NOW)?.at).toEqual(NOW);
    expect(deliveryFromEvent({ type: "email.delivered", data: { email_id: "x" } }, NOW)?.at).toEqual(NOW);
  });
});

describe("nextDelivery", () => {
  const at = new Date("2026-11-10T09:00:00Z");
  const next = (current: Delivery | null, delivery: Delivery) => nextDelivery(current, { delivery, at })?.delivery ?? null;

  it("takes the first event, and a stronger one later", () => {
    expect(next(null, "soft_bounced")).toBe("soft_bounced");
    expect(next("soft_bounced", "delivered")).toBe("delivered");
    expect(next("delivered", "complained")).toBe("complained");
    expect(next("soft_bounced", "bounced")).toBe("bounced");
  });

  it("keeps the stronger state when a weaker or the same event comes after it", () => {
    expect(next("complained", "delivered")).toBeNull();
    expect(next("bounced", "soft_bounced")).toBeNull();
    expect(next("delivered", "soft_bounced")).toBeNull();
    expect(next("delivered", "delivered")).toBeNull();
  });
});

describe("sentVia", () => {
  it("tells the relay's Message-ID, Resend's id and local dev apart", () => {
    expect(sentVia("<1731.abc@padelparbaj.hu>")).toBe("relay");
    expect(sentVia("4ef9a417-02e9-4d39-ad75-9611e0fcc33c")).toBe("resend");
    expect(sentVia("dev-4ef9a417")).toBe("console");
    expect(sentVia(null)).toBeNull();
    expect(sentVia("")).toBeNull();
  });
});

describe("commsStatus", () => {
  const sent = { status: "sent" as const, providerId: "re_1", delivery: null, lastError: null };

  it("names every state in Hungarian", () => {
    expect(commsStatus({ ...sent, status: "pending" }).label).toBe("Sorban vár");
    expect(commsStatus({ ...sent, status: "sending" }).label).toBe("Küldés alatt");
    expect(commsStatus(sent)).toEqual({ label: "Elküldve", tone: "ok", note: null });
    expect(commsStatus({ ...sent, delivery: "delivered" }).label).toBe("Kézbesítve");
    expect(commsStatus({ ...sent, delivery: "bounced" })).toMatchObject({ label: "Visszapattant", tone: "bad" });
    expect(commsStatus({ ...sent, delivery: "soft_bounced" }).label).toBe("Átmenetileg visszapattant");
    expect(commsStatus({ ...sent, delivery: "complained" }).label).toBe("Spamnek jelölte");
  });

  it("says a relay email's delivery isn't tracked, unless a bounce for it is known", () => {
    const relay = { ...sent, providerId: "<a@padelparbaj.hu>" };
    expect(commsStatus(relay)).toEqual({ label: "Elküldve", tone: "ok", note: "A Google-relé nem jelzi vissza a kézbesítést." });
    expect(commsStatus({ ...relay, delivery: "bounced" }).label).toBe("Visszapattant");
  });

  it("shows a failure's reason with every address hidden", () => {
    const failed = commsStatus({ ...sent, status: "failed", lastError: "550 5.1.1 <bela@x.hu>: no such user" });
    expect(failed.label).toBe("Nem ment ki");
    expect(failed.note).toContain("550 5.1.1");
    expect(failed.note).not.toContain("bela@x.hu");
  });
});

describe("the log's header and subjects", () => {
  it("says since when an address is blocked, and why", () => {
    expect(suppressionNote(null)).toBeNull();
    expect(suppressionNote({ reason: "bounced", since: new Date("2026-11-02T09:15:00Z") })).toBe(
      "Letiltott cím: a cím visszapattant, 2026. 11. 02. 10:15 óta. Körlevelet és értesítő levelet nem küldünk rá.",
    );
  });

  it("hides another person's address in a subject", () => {
    expect(shownSubject("pair_created", "Párod: Béla (bela@x.hu)")).not.toContain("bela@x.hu");
  });

  it("never shows a login code, only that one was sent", () => {
    expect(shownSubject("login_code", "216 950 a belépőkódod – Padelpárbaj")).toBe("••• ••• a belépőkódod – Padelpárbaj");
    expect(shownSubject("match_proposal", "3 időpont")).toBe("3 időpont");
  });
});

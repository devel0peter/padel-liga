import { describe, expect, it } from "vitest";

import { suppressionsFromEvent, TOLERANCE_SECONDS, verifyWebhook } from "./webhook";

// Svix's published test vector.
const secret = "whsec_plJ3nmyCDGBKInavdOK15jsl";
const body = '{"event_type":"ping","data":{"success":true}}';
const id = "msg_loFOjxBNrRLzqYUf";
const timestamp = "1731705121";
const signature = "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=";
const now = 1731705121;

describe("verifyWebhook", () => {
  it("accepts the Svix test vector", async () => {
    expect(await verifyWebhook(body, { id, timestamp, signature }, secret, now)).toBe(true);
  });

  it("accepts when one of several signatures matches", async () => {
    const several = `v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= ${signature}`;
    expect(await verifyWebhook(body, { id, timestamp, signature: several }, secret, now)).toBe(true);
  });

  it("rejects a changed body, id or secret", async () => {
    expect(await verifyWebhook(body.replace("true", "false"), { id, timestamp, signature }, secret, now)).toBe(false);
    expect(await verifyWebhook(body, { id: "msg_other", timestamp, signature }, secret, now)).toBe(false);
    expect(await verifyWebhook(body, { id, timestamp, signature }, "whsec_c2VjcmV0", now)).toBe(false);
  });

  it("rejects an old or future timestamp", async () => {
    expect(await verifyWebhook(body, { id, timestamp, signature }, secret, now + TOLERANCE_SECONDS + 1)).toBe(false);
    expect(await verifyWebhook(body, { id, timestamp, signature }, secret, now - TOLERANCE_SECONDS - 1)).toBe(false);
  });

  it("rejects missing headers, an empty secret or junk signatures", async () => {
    expect(await verifyWebhook(body, { id: null, timestamp, signature }, secret, now)).toBe(false);
    expect(await verifyWebhook(body, { id, timestamp, signature }, "", now)).toBe(false);
    expect(await verifyWebhook(body, { id, timestamp, signature: "v1,!!!not base64" }, secret, now)).toBe(false);
    expect(await verifyWebhook(body, { id, timestamp, signature: "v2,abc" }, secret, now)).toBe(false);
  });
});

describe("suppressionsFromEvent", () => {
  it("suppresses permanent bounces, lowercased", () => {
    const event = { type: "email.bounced", data: { to: ["Anna@Example.com"], bounce: { type: "Permanent" } } };
    expect(suppressionsFromEvent(event)).toEqual([{ email: "anna@example.com", reason: "bounced" }]);
  });

  it("keeps an address after a temporary bounce", () => {
    const event = { type: "email.bounced", data: { to: ["anna@example.com"], bounce: { type: "Temporary" } } };
    expect(suppressionsFromEvent(event)).toEqual([]);
  });

  it("suppresses spam complaints", () => {
    const event = { type: "email.complained", data: { to: ["bela@example.hu"] } };
    expect(suppressionsFromEvent(event)).toEqual([{ email: "bela@example.hu", reason: "complained" }]);
  });

  it("ignores other events and malformed data", () => {
    expect(suppressionsFromEvent({ type: "email.delivered", data: { to: ["a@b.hu"] } })).toEqual([]);
    expect(suppressionsFromEvent({ type: "email.complained", data: { to: "a@b.hu" } })).toEqual([]);
    expect(suppressionsFromEvent({})).toEqual([]);
  });
});

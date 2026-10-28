import { describe, expect, it } from "vitest";

import { buildMessage, encodeWords, isSafeAddress, smtpData, type MimeEmail } from "./mime";
import { REPLY_TO, SENDER } from "./sender";
import { unsubscribeHeaders } from "./unsubscribe";

// RFC 2047 encoded words back to text, the way a mail client reads them.
function decodeWords(value: string): string {
  const bytes: number[] = [];
  for (const [, b64] of value.matchAll(/=\?UTF-8\?B\?([^?]*)\?=/g)) for (const c of atob(b64)) bytes.push(c.charCodeAt(0));
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

function parse(message: string) {
  const [head, ...rest] = message.split("\r\n\r\n");
  const headers = new Map<string, string>();
  for (const line of head.replace(/\r\n /g, " ").split("\r\n")) {
    const at = line.indexOf(": ");
    headers.set(line.slice(0, at), line.slice(at + 2));
  }
  return { headers, body: rest.join("\r\n\r\n") };
}

// The base64 part of the given type, decoded as UTF-8.
function partText(body: string, type: "plain" | "html"): string {
  const m = new RegExp(`Content-Type: text/${type}; charset=UTF-8\\r\\nContent-Transfer-Encoding: base64\\r\\n\\r\\n([A-Za-z0-9+/=\\r\\n]+)`).exec(body);
  if (!m) throw new Error(`no ${type} part`);
  const bin = atob(m[1].replace(/\r\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const email = (over: Partial<MimeEmail> = {}): MimeEmail => ({
  from: SENDER,
  replyTo: REPLY_TO,
  to: "anna@example.com",
  subject: "Jóváhagyták a nevezéseteket – Padelpárbaj",
  text: "Szia Ödön!\n\nŐszi szezon, győri ügyességi űrlap.",
  html: "<p>Szia Ödön! Őszi szezon, győri ügyességi űrlap.</p>",
  messageId: "abc-123@padelparbaj.hu",
  date: new Date("2026-10-28T21:00:00Z"),
  ...over,
});

describe("encodeWords", () => {
  it("leaves plain ASCII alone", () => {
    expect(encodeWords("Hello there")).toBe("Hello there");
  });

  it("encodes Hungarian text in words of at most 75 characters, without splitting a character", () => {
    const subject = "Árvíztűrő tükörfúrógép: őszi ütemterv, ünnepi űrlap és még több ékezet – ŐŰ";
    const encoded = encodeWords(subject);
    for (const word of encoded.split("\r\n ")) {
      expect(word.length).toBeLessThanOrEqual(75);
      expect(() => new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(word.slice(10, -2)), (c) => c.charCodeAt(0)))).not.toThrow();
    }
    expect(encoded.split("\r\n ").length).toBeGreaterThan(1);
    expect(decodeWords(encoded)).toBe(subject);
  });

  it("drops line breaks, so a subject can't add a header", () => {
    expect(encodeWords("Hi\r\nBcc: x@y.hu")).toBe("Hi Bcc: x@y.hu");
  });
});

describe("buildMessage", () => {
  it("keeps the sender name, reply-to, subject and both bodies intact with á, é, ő, ű", () => {
    const { headers, body } = parse(buildMessage(email()));
    expect(headers.get("To")).toBe("<anna@example.com>");
    expect(headers.get("Reply-To")).toBe("hello@padelparbaj.hu");
    expect(headers.get("From")).toMatch(/ <hello@padelparbaj\.hu>$/);
    expect(decodeWords(headers.get("From")!)).toBe("Péter, Padelpárbaj");
    expect(decodeWords(headers.get("Subject")!)).toBe("Jóváhagyták a nevezéseteket – Padelpárbaj");
    expect(headers.get("Message-ID")).toBe("<abc-123@padelparbaj.hu>");
    expect(headers.get("Date")).toBe("Wed, 28 Oct 2026 21:00:00 +0000");
    expect(headers.get("MIME-Version")).toBe("1.0");
    expect(headers.get("Content-Type")).toMatch(/^multipart\/alternative; boundary="/);
    expect(partText(body, "plain")).toBe("Szia Ödön!\n\nŐszi szezon, győri ügyességi űrlap.");
    expect(partText(body, "html")).toBe("<p>Szia Ödön! Őszi szezon, győri ügyességi űrlap.</p>");
  });

  it("keeps the one-click unsubscribe headers of a bulk email", () => {
    const url = "https://padelparbaj.hu/unsubscribe?t=YW5uYUBleGFtcGxlLmNvbQ.c2lnbmF0dXJl";
    const { headers } = parse(buildMessage(email({ headers: unsubscribeHeaders(url) })));
    expect(headers.get("List-Unsubscribe")).toBe(`<${url}>`);
    expect(headers.get("List-Unsubscribe-Post")).toBe("List-Unsubscribe=One-Click");
  });

  it("drops an extra header with a bad name and line breaks in its value", () => {
    const message = buildMessage(email({ headers: { "Bad Name": "x", "X-Ok": "a\r\nBcc: evil@x.hu" } }));
    expect(message).not.toContain("Bad Name");
    expect(parse(message).headers.get("X-Ok")).toBe("a Bcc: evil@x.hu");
    expect(message).not.toMatch(/\r\nBcc:/);
  });

  it("sends a text-only email as one plain part", () => {
    const { headers, body } = parse(buildMessage(email({ html: "", text: "Csak szöveg: ő" })));
    expect(headers.get("Content-Type")).toBe("text/plain; charset=UTF-8");
    expect(headers.get("Content-Transfer-Encoding")).toBe("base64");
    expect(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/\r\n/g, "")), (c) => c.charCodeAt(0)))).toBe("Csak szöveg: ő");
  });

  it("uses CRLF line endings and lines no longer than 998 characters", () => {
    const message = buildMessage(email({ text: "x".repeat(5000), html: `<p>${"é".repeat(3000)}</p>` }));
    expect(message).not.toMatch(/[^\r]\n/);
    for (const line of message.split("\r\n")) expect(line.length).toBeLessThanOrEqual(998);
  });
});

describe("smtpData", () => {
  it("doubles a leading dot and ends with a lone dot", () => {
    expect(smtpData("a\r\n.b\r\n")).toBe("a\r\n..b\r\n.\r\n");
    expect(smtpData(".x")).toBe("..x\r\n.\r\n");
  });
});

describe("isSafeAddress", () => {
  it("accepts a plain address and refuses one that could break an SMTP line", () => {
    expect(isSafeAddress("anna.nagy+liga@example.com")).toBe(true);
    for (const bad of ["a b@x.hu", "a@x.hu>\r\nRCPT TO:<b@x.hu", "<a@x.hu>", "nope", "a@b@c", ""]) expect(isSafeAddress(bad), bad).toBe(false);
  });
});

// An email as the SMTP relay wants it (RFC 5322 + MIME): headers, then a
// plain-text and an HTML part. Pure (no I/O). Non-ASCII header text (á, é, ő,
// ű in a subject or name) is sent as RFC 2047 encoded words, bodies as UTF-8
// base64, so nothing depends on the relay being 8-bit clean.

export type MimeEmail = {
  from: { name: string; address: string };
  replyTo: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  // Extra headers, e.g. List-Unsubscribe.
  headers?: Record<string, string>;
  messageId: string;
  date: Date;
};

const CRLF = "\r\n";
const enc = new TextEncoder();

// An address we put on an SMTP command line or in a header: no spaces, no
// angle brackets, no line breaks, exactly one @.
export function isSafeAddress(address: string): boolean {
  return /^[^\s<>()[\]\\,;:"@]+@[^\s<>()[\]\\,;:"@]+$/.test(address);
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// A header value can't carry a line break: that would start a new header.
function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

// Encoded words of at most 75 characters each (RFC 2047): 45 UTF-8 bytes are
// 60 base64 characters, plus "=?UTF-8?B?" and "?=". A character is never
// split across two words.
export function encodeWords(value: string): string {
  const text = oneLine(value);
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  const words: number[][] = [];
  let chunk: number[] = [];
  for (const ch of text) {
    const bytes = enc.encode(ch);
    if (chunk.length + bytes.length > 45) {
      words.push(chunk.splice(0));
    }
    chunk.push(...bytes);
  }
  if (chunk.length) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64(Uint8Array.from(w))}?=`).join(`${CRLF} `);
}

// Base64 in lines of 76 characters (RFC 2045).
function base64Body(text: string): string {
  return (base64(enc.encode(text)).match(/.{1,76}/g) ?? []).join(CRLF);
}

// RFC 5322 date, e.g. "Wed, 28 Oct 2026 21:00:00 +0000".
function rfc5322Date(date: Date): string {
  return date.toUTCString().replace(/GMT$/, "+0000");
}

function part(type: "plain" | "html", body: string): string {
  return [`Content-Type: text/${type}; charset=UTF-8`, "Content-Transfer-Encoding: base64", "", base64Body(body)].join(CRLF);
}

// The whole message, CRLF line endings, without SMTP's final ".".
export function buildMessage(email: MimeEmail): string {
  const headers: [string, string][] = [
    ["From", `${encodeWords(email.from.name)} <${email.from.address}>`],
    ["To", `<${email.to}>`],
    ["Reply-To", email.replyTo],
    ["Subject", encodeWords(email.subject)],
    ["Date", rfc5322Date(email.date)],
    ["Message-ID", `<${email.messageId}>`],
    ["MIME-Version", "1.0"],
  ];
  for (const [name, value] of Object.entries(email.headers ?? {}))
    if (/^[A-Za-z0-9-]+$/.test(name)) headers.push([name, oneLine(value)]);

  let body: string;
  if (email.html) {
    const boundary = `=_${email.messageId.replace(/[^A-Za-z0-9]/g, "")}`;
    headers.push(["Content-Type", `multipart/alternative; boundary="${boundary}"`]);
    body = [
      "This is a multi-part message in MIME format.",
      `--${boundary}`,
      part("plain", email.text),
      `--${boundary}`,
      part("html", email.html),
      `--${boundary}--`,
      "",
    ].join(CRLF);
  } else {
    headers.push(["Content-Type", "text/plain; charset=UTF-8"], ["Content-Transfer-Encoding", "base64"]);
    body = `${base64Body(email.text)}${CRLF}`;
  }
  return `${headers.map(([n, v]) => `${n}: ${v}`).join(CRLF)}${CRLF}${CRLF}${body}`;
}

// SMTP DATA: a line starting with "." gets a second one (RFC 5321 4.5.2),
// and the message ends with a line holding only ".".
export function smtpData(message: string): string {
  const stuffed = message.replace(/(^|\r\n)\./g, "$1..");
  return `${stuffed}${stuffed.endsWith(CRLF) ? "" : CRLF}.${CRLF}`;
}

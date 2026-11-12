// Email open tracking (#243, D161): every stored email except a login code
// gets a random token when it is queued, and its HTML gets a 1x1 image
// whose address carries that token when it is sent. Loading the image
// (routes/email-open.ts) marks that one email opened: the first time and a
// count, nothing about the reader. Pure (no I/O); the D1 side is
// comms-log.server.ts (recordOpen).

import { formatDateTime } from "~/lib/format";

import type { MessageKind } from "./budget";

// The image's path; the log shows it without the token (lib/log.ts).
export const OPEN_PATH = "/email/open/";

// A login code is never tracked (Peter, 2026-11-04): it is read once, at
// once, and must stay as plain as possible.
export function tracksOpens(kind: MessageKind): boolean {
  return kind !== "login_code";
}

// 128 random bits as hex: unguessable, and says nothing about the email,
// its address or how many emails there are (no id in it).
export function newOpenToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

const TOKEN_SHAPE = /^[0-9a-f]{32}$/;

// Anything else never reaches the database.
export function isOpenToken(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

export function openImageUrl(siteUrl: string, token: string): string {
  return `${siteUrl}${OPEN_PATH}${token}`;
}

// The email's HTML with the tracking image at the end of the body. An email
// without HTML stays as it is (a text-only mail can't be tracked).
export function withOpenImage(html: string, url: string): string {
  if (!html) return html;
  const img = `<img src="${url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0">`;
  const end = html.lastIndexOf("</body>");
  return end < 0 ? `${html}${img}` : `${html.slice(0, end)}${img}\n${html.slice(end)}`;
}

// A transparent 1x1 GIF, the answer to every image request, known token or not.
export const TRANSPARENT_GIF = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (c) => c.charCodeAt(0),
);

export const OPEN_IMAGE_HEADERS = {
  "Content-Type": "image/gif",
  // Every load must reach us, never a cache (a mail app's or a proxy's).
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
  Expires: "0",
  "X-Robots-Tag": "noindex",
  "Referrer-Policy": "no-referrer",
} as const;

// The line under an email's state in the Admin's log (#243): the first open
// (Budapest time) and how many there were, or that nobody knows; null for an
// email that isn't tracked (a login code, one from before the tracking) or
// hasn't gone out yet.
export function openStatus(row: {
  tracked: boolean;
  status: string;
  openedAt: Date | null;
  openCount: number;
}): string | null {
  if (!row.tracked || row.status !== "sent") return null;
  if (!row.openedAt || row.openCount === 0) return "Nem ismert, hogy megnyitotta";
  return `Megnyitva: ${formatDateTime(row.openedAt)} · ${row.openCount} megnyitás`;
}

// The log's one note on what an open means.
export const OPENS_NOTE =
  "A megnyitás csak becslés: van levelezőprogram, ami magától betölti a képeket (ilyenkor olvasatlanul is megnyitottnak látszik), és van, ami letiltja őket (ilyenkor elolvasva sem látszik).";

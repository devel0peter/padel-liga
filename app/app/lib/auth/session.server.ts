import { and, eq, gt } from "drizzle-orm";
import { redirect } from "react-router";

import { db } from "~/db/client.server";
import { sessions, users } from "~/db/schema";

import { extendedExpiry, parseCookies, serializeCookie, sessionExpiry } from "./rules";
import { randomToken, sha256Hex } from "./tokens";

// Session cookie: a random token; the database keeps only its hash and the
// expiry, which is the real limit. The cookie itself lives as long as browsers
// allow (~400 days), so extending a session needs no new cookie.
// __Host- makes the browser refuse it unless Secure, Path=/ and no Domain.
const COOKIE = import.meta.env.DEV ? "pp_session" : "__Host-pp_session";
const SECURE = !import.meta.env.DEV;
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export type User = typeof users.$inferSelect;

// One lookup per request, however many loaders ask.
const cache = new WeakMap<Request, Promise<User | null>>();

function sessionToken(request: Request): string | null {
  return parseCookies(request.headers.get("Cookie")).get(COOKIE) || null;
}

// Returns the Set-Cookie header to send with the response.
export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  await db.insert(sessions).values({ idHash: await sha256Hex(token), userId, expiresAt: sessionExpiry(new Date()) });
  return serializeCookie(COOKIE, token, { maxAgeSeconds: COOKIE_MAX_AGE, secure: SECURE });
}

async function lookup(request: Request): Promise<User | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const idHash = await sha256Hex(token);
  const now = new Date();
  const [row] = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.idHash, idHash), gt(sessions.expiresAt, now)));
  if (!row) return null;
  const extended = extendedExpiry(row.expiresAt, now);
  if (extended) await db.update(sessions).set({ expiresAt: extended }).where(eq(sessions.idHash, idHash));
  return row.user;
}

export function getUser(request: Request): Promise<User | null> {
  let user = cache.get(request);
  if (!user) {
    user = lookup(request);
    cache.set(request, user);
  }
  return user;
}

function loginRedirect(request: Request, to: string): never {
  const url = new URL(request.url);
  throw redirect(`${to}?vissza=${encodeURIComponent(url.pathname + url.search)}`);
}

// Logged in, first-login profile not necessarily done (the profile page itself).
export async function requireAccount(request: Request): Promise<User> {
  const user = await getUser(request);
  if (!user) loginRedirect(request, "/belepes");
  return user;
}

// Logged in with name and privacy consent: every other account page.
export async function requireUser(request: Request): Promise<User> {
  const user = await requireAccount(request);
  if (!user.consentAt) loginRedirect(request, "/udvozlunk");
  return user;
}

// Ends this session; returns the Set-Cookie header that clears the cookie.
export async function destroySession(request: Request): Promise<string> {
  const token = sessionToken(request);
  if (token) await db.delete(sessions).where(eq(sessions.idHash, await sha256Hex(token)));
  return serializeCookie(COOKIE, "", { maxAgeSeconds: 0, secure: SECURE });
}

// "Kilépés mindenhonnan": every device of this user.
export async function destroyAllSessions(userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

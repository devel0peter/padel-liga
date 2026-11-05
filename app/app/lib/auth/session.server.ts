import { and, eq, gt } from "drizzle-orm";
import { redirect } from "react-router";

import { db } from "~/db/client.server";
import { leagueAdmins, leagues, sessions, users } from "~/db/schema";

import { noteAccount } from "~/lib/log";

import type { LeagueRef } from "./permissions";
import { nextExpiry, parseCookies, serializeCookie, sessionExpiry } from "./rules";
import { randomToken, sha256Hex } from "./tokens";

// Session cookie: a random token; the database keeps only its hash and the
// expiry, which is the real limit (90 days, Admin 12 hours: rules.ts). The cookie itself lives as long as browsers
// allow (~400 days), so extending a session needs no new cookie.
// __Host- makes the browser refuse it unless Secure, Path=/ and no Domain.
const COOKIE = import.meta.env.DEV ? "pp_session" : "__Host-pp_session";
const SECURE = !import.meta.env.DEV;
const COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

export type User = typeof users.$inferSelect;

// The logged-in user and the leagues they organize (for their roles).
export type SessionData = { user: User; leagues: LeagueRef[] };

// One lookup per request, however many middlewares and loaders ask.
const cache = new WeakMap<Request, Promise<SessionData | null>>();

function sessionToken(request: Request): string | null {
  return parseCookies(request.headers.get("Cookie")).get(COOKIE) || null;
}

// Returns the Set-Cookie header to send with the response. Every login comes
// here, so it also records the login time (the Admin's user list).
export async function createSession(userId: string): Promise<string> {
  const token = randomToken();
  const now = new Date();
  const [user] = await db
    .update(users)
    .set({ lastLoginAt: now })
    .where(eq(users.id, userId))
    .returning({ role: users.platformRole });
  const expiresAt = sessionExpiry(now, user?.role);
  await db.insert(sessions).values({ idHash: await sha256Hex(token), userId, expiresAt });
  return serializeCookie(COOKIE, token, { maxAgeSeconds: COOKIE_MAX_AGE, secure: SECURE });
}

async function lookup(request: Request): Promise<SessionData | null> {
  const token = sessionToken(request);
  if (!token) return null;
  const idHash = await sha256Hex(token);
  const now = new Date();
  const valid = and(eq(sessions.idHash, idHash), gt(sessions.expiresAt, now));
  // One D1 round trip for both: every page behind login needs the user and
  // their roles, and each round trip to the database is the slow part.
  const [[row], organized] = await db.batch([
    db
      .select({ user: users, expiresAt: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(valid),
    db
      .select({ id: leagues.id, slug: leagues.slug, city: leagues.city, name: leagues.name })
      .from(sessions)
      .innerJoin(leagueAdmins, eq(leagueAdmins.userId, sessions.userId))
      .innerJoin(leagues, eq(leagues.id, leagueAdmins.leagueId))
      .where(valid)
      .orderBy(leagues.name),
  ]);
  if (!row) return null;
  const extended = nextExpiry(row.expiresAt, now, row.user.platformRole);
  if (extended) await db.update(sessions).set({ expiresAt: extended }).where(eq(sessions.idHash, idHash));
  return { user: row.user, leagues: organized };
}

export function getSession(request: Request): Promise<SessionData | null> {
  let session = cache.get(request);
  if (!session) {
    session = lookup(request).then((found) => {
      // The request line names the account by id (#227).
      if (found) noteAccount(request, found.user.id);
      return found;
    });
    cache.set(request, session);
  }
  return session;
}

export async function getUser(request: Request): Promise<User | null> {
  return (await getSession(request))?.user ?? null;
}

function loginRedirect(request: Request, to: string): never {
  const url = new URL(request.url);
  // A client navigation fetches /page.data (/_root.data for "/"); come back
  // to the page itself, without React Router's own query parameters.
  const path = url.pathname.replace(/^\/_root\.data$/, "/").replace(/\.data$/, "");
  url.searchParams.delete("_routes");
  const back = path + (url.searchParams.size ? `?${url.searchParams}` : "");
  throw redirect(`${to}?returnTo=${encodeURIComponent(back)}`);
}

// Logged in, first-login profile not necessarily done (the profile page itself).
export async function requireAccount(request: Request): Promise<User> {
  const user = await getUser(request);
  if (!user) loginRedirect(request, "/login");
  return user;
}

// Logged in with name and privacy consent: every other account page. An
// account from before the sex was asked (#133) answers it once on /welcome,
// then goes on where it was going.
export async function requireUser(request: Request): Promise<User> {
  const user = await requireAccount(request);
  if (!finishedFirstLogin(user)) loginRedirect(request, "/welcome");
  return user;
}

// Done with the first-login page (name, privacy consent, sex): a member, who
// may see what is for logged-in members only (profiles, ratings; D112).
export function finishedFirstLogin(user: Pick<User, "consentAt" | "sex">): boolean {
  return !!user.consentAt && !!user.sex;
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

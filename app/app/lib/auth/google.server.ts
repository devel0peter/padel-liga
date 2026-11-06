import { env } from "cloudflare:workers";
import { decodeIdToken, generateCodeVerifier, generateState, Google } from "arctic";
import { and, eq } from "drizzle-orm";
import { redirect } from "react-router";

import { db } from "~/db/client.server";
import { oauthAccounts } from "~/db/schema";
import { leagueOfReturnTo } from "~/lib/league-members";
import { joinFromRegisterButton } from "~/lib/league-members.server";

import { createUser, findUserIdByEmail, setProfileImage } from "./accounts.server";
import { googlePicture, normalizeEmail, parseCookies, resolveGoogleLogin, safeReturnTo, serializeCookie } from "./rules";
import { createSession } from "./session.server";
import { timingSafeEqual } from "./tokens";
import { logInfo, logWarn } from "~/lib/log";

// Google login: OAuth authorization code flow with PKCE and state (arctic).
// The ID token comes straight from Google's token endpoint over TLS, so its
// claims can be trusted without checking the signature (OIDC Core 3.1.3.7).

const FLOW_COOKIE = import.meta.env.DEV ? "pp_google" : "__Host-pp_google";
const SECURE = !import.meta.env.DEV;
const FLOW_MAX_AGE = 10 * 60;

export function googleConfigured(): boolean {
  const id: string = env.GOOGLE_CLIENT_ID;
  return !!id && !!env.GOOGLE_CLIENT_SECRET;
}

function client(request: Request): Google {
  const callback = new URL("/auth/google/callback", request.url).toString();
  return new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, callback);
}

// Error codes for /login?error=… (messages in app/routes/login.tsx).
export type GoogleError = "google" | "unverified";

function fail(error: GoogleError): never {
  logWarn("login", { method: "google", outcome: error === "unverified" ? "unverified" : "failed" });
  throw redirect(`/login?error=${error}`, {
    headers: { "Set-Cookie": serializeCookie(FLOW_COOKIE, "", { maxAgeSeconds: 0, secure: SECURE }) },
  });
}

export function startGoogleLogin(request: Request): Response {
  if (!googleConfigured()) fail("google");
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  const state = generateState();
  const verifier = generateCodeVerifier();
  const url = client(request).createAuthorizationURL(state, verifier, ["openid", "email", "profile"]);
  // Lets someone with several Google accounts pick the right one.
  url.searchParams.set("prompt", "select_account");
  const flow = [state, verifier, encodeURIComponent(returnTo)].join(".");
  return redirect(url.toString(), {
    headers: { "Set-Cookie": serializeCookie(FLOW_COOKIE, flow, { maxAgeSeconds: FLOW_MAX_AGE, secure: SECURE }) },
  });
}

type GoogleClaims = { sub: string; email?: string; email_verified?: boolean; name?: string; picture?: string };

export async function finishGoogleLogin(request: Request): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const flow = parseCookies(request.headers.get("Cookie")).get(FLOW_COOKIE);
  const [state, verifier, returnTo] = (flow ?? "").split(".");
  const code = params.get("code");
  const gotState = params.get("state") ?? "";
  if (!code || !state || !verifier || !timingSafeEqual(state, gotState)) fail("google");

  let claims: GoogleClaims;
  try {
    const tokens = await client(request).validateAuthorizationCode(code, verifier);
    claims = decodeIdToken(tokens.idToken()) as GoogleClaims;
  } catch (error) {
    logWarn("google code exchange failed", { error });
    fail("google");
  }
  if (!claims.sub || !claims.email) fail("google");

  const email = normalizeEmail(claims.email);
  const [linked] = await db
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .where(and(eq(oauthAccounts.provider, "google"), eq(oauthAccounts.providerUserId, claims.sub)));
  const decision = resolveGoogleLogin({
    linkedUserId: linked?.userId ?? null,
    emailUserId: await findUserIdByEmail(email),
    emailVerified: claims.email_verified === true,
  });

  let userId: string;
  switch (decision.kind) {
    case "refused":
      fail(decision.reason);
    case "existing":
      userId = decision.userId;
      break;
    case "link":
      userId = decision.userId;
      await db.insert(oauthAccounts).values({ provider: "google", providerUserId: claims.sub, userId }).onConflictDoNothing();
      break;
    case "create":
      // Google's name pre-fills the first-login page; they can change it there.
      userId = await createUser(email, (claims.name ?? "").trim().slice(0, 80));
      await db.insert(oauthAccounts).values({ provider: "google", providerUserId: claims.sub, userId }).onConflictDoNothing();
      break;
  }

  logInfo("login", { method: "google", outcome: "ok", userId, created: decision.kind === "create" });
  await setProfileImage(userId, googlePicture(claims.picture));

  const headers = new Headers();
  headers.append("Set-Cookie", await createSession(userId));
  headers.append("Set-Cookie", serializeCookie(FLOW_COOKIE, "", { maxAgeSeconds: 0, secure: SECURE }));
  let back = "";
  try {
    back = decodeURIComponent(returnTo ?? "");
  } catch {
    // Malformed: safeReturnTo falls back to the default page.
  }
  // Through a league's register button: that league, also before the
  // first-login page is done (D128, #331).
  await joinFromRegisterButton(userId, leagueOfReturnTo(safeReturnTo(back)));
  return redirect(safeReturnTo(back), { headers });
}

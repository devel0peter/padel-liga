// Pure helper for app/lib/access.server.ts.

// The Access token comes in the Cf-Access-Jwt-Assertion header on requests
// that Access itself protects. React Router's data requests for /admin go to
// /admin.data, which the Access app's path (/admin, /admin/*) doesn't cover,
// so those only carry the CF_Authorization cookie (same signed token).
export function accessToken(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookies = request.headers.get("Cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "CF_Authorization" && rest.length) return rest.join("=");
  }
  return null;
}

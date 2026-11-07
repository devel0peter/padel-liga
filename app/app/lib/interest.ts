// The playing levels and the email pattern, left from the landing page's
// interest form (its parsing went with the interest list, #334, D132).
// Pure (no I/O), used on both server and client.

export const LEVELS = {
  kezdo: "Kezdő – most ismerkedünk a játékkal",
  kozephalado: "Középhaladó – rendszeresen játszunk",
  halado: "Haladó – versenyeken is indulunk",
  versenyzo: "Versenyző – eredményesen versenyzünk",
} as const;

export type Level = keyof typeof LEVELS;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLevel(value: string): value is Level {
  return Object.hasOwn(LEVELS, value);
}

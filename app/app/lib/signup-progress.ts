// Where each person on the interest list is on the way to a league entry
// (Jelentkezők, "Hol tart"): invited, account, pair, entry. Pure, so every
// stage is unit tested; the route passes the statuses (player-status.server.ts).

import type { PlayerStatus, StatusChip } from "./player-status";
import type { SignupRow } from "./signups-admin";

// In funnel order; the last three are off the way (no league to play in,
// withdrawn, or a pair while the league has no season to enter).
export const STAGES = {
  not_invited: "Nem kapott meghívót",
  no_account: "Meghívót kapott, nincs fiókja",
  unfinished: "Félbehagyta a regisztrációt",
  no_pair: "Regisztrált, nincs párja",
  not_entered: "Van párja, nem nevezett",
  entered: "Nevezett",
  paired: "Van párja, nincs szezon",
  no_league: "Nincs liga a városában",
  withdrawn: "Visszalépett",
} as const;

export type Stage = keyof typeof STAGES;

// The stages the summary always shows, even at zero.
export const FUNNEL: readonly Stage[] = ["not_invited", "no_account", "unfinished", "no_pair", "not_entered", "entered"];

export function isStage(value: string): value is Stage {
  return Object.hasOwn(STAGES, value);
}

type Signup = Pick<SignupRow, "id" | "mode" | "email1" | "email2" | "city" | "status" | "invitedAt" | "invited2At">;

// Lowercased addresses the registration invite went to, through any signup.
export function invitedEmails(rows: readonly Signup[]): Set<string> {
  const invited = new Set<string>();
  for (const r of rows) {
    if (r.invitedAt) invited.add(r.email1.toLowerCase());
    if (r.invited2At && r.email2) invited.add(r.email2.toLowerCase());
  }
  return invited;
}

// The people a signup names, with an email: the signer, and the partner of a
// pair signup when given.
export function signupEmails(r: Pick<Signup, "mode" | "email1" | "email2">): string[] {
  return [r.email1, ...(r.mode === "pair" && r.email2 ? [r.email2] : [])].map((e) => e.toLowerCase());
}

// One person's stage. An account counts over the signup: someone who marked
// themselves withdrawn but registered anyway shows where they are now.
// `leagueIds`: the leagues of the signup's city.
export function personStage(p: {
  status: PlayerStatus | undefined;
  invited: boolean;
  withdrawn: boolean;
  leagueIds: readonly number[];
}): Stage {
  const s = p.status;
  if (!s) {
    if (p.withdrawn) return "withdrawn";
    if (p.leagueIds.length === 0) return "no_league";
    return p.invited ? "no_account" : "not_invited";
  }
  if (!s.registered) return "unfinished";
  if (p.leagueIds.length === 0) return "no_league";
  const mine = s.pairs.filter((x) => p.leagueIds.includes(x.leagueId));
  if (mine.length === 0) return "no_pair";
  if (mine.some((x) => x.entry && (x.entry.status === "pending" || x.entry.status === "approved"))) return "entered";
  return mine.some((x) => x.season) ? "not_entered" : "paired";
}

export type ProgressContext = {
  invited: ReadonlySet<string>;
  status: (email: string) => PlayerStatus | undefined;
  leagueIds: (city: string) => readonly number[];
};

// Each signup's people's stages, in signupEmails order.
export function signupStages(r: Signup, ctx: ProgressContext): Stage[] {
  const leagueIds = ctx.leagueIds(r.city);
  return signupEmails(r).map((email) =>
    personStage({ status: ctx.status(email), invited: ctx.invited.has(email), withdrawn: r.status === "withdrawn", leagueIds }),
  );
}

// People per stage over `rows`, each address once (its first row: the list
// is newest first).
export function stageCounts(rows: readonly Signup[], ctx: ProgressContext): Record<Stage, number> {
  const counts = Object.fromEntries(Object.keys(STAGES).map((k) => [k, 0])) as Record<Stage, number>;
  const seen = new Set<string>();
  for (const r of rows) {
    const stages = signupStages(r, ctx);
    signupEmails(r).forEach((email, i) => {
      if (seen.has(email)) return;
      seen.add(email);
      counts[stages[i]]++;
    });
  }
  return counts;
}

// The invite chip next to "Nincs fiókja".
export function inviteChip(stage: Stage): StatusChip | null {
  if (stage === "not_invited") return { text: STAGES.not_invited, tone: "todo" };
  if (stage === "no_account") return { text: "Meghívót kapott", tone: "muted" };
  return null;
}

// The context from the whole interest list (the invites), the statuses by
// lowercased email and the leagues.
export function progressContext(
  all: readonly Signup[],
  byEmail: ReadonlyMap<string, PlayerStatus>,
  leagues: readonly { id: number; city: string }[],
): ProgressContext {
  return {
    invited: invitedEmails(all),
    status: (email) => byEmail.get(email.toLowerCase()),
    leagueIds: (city) => leagues.filter((l) => l.city === city).map((l) => l.id),
  };
}

// The signups with at least one person at `stage` (all when it's null).
export function filterByStage<T extends Signup>(rows: readonly T[], stage: Stage | null, ctx: ProgressContext): T[] {
  return stage ? rows.filter((r) => signupStages(r, ctx).includes(stage)) : [...rows];
}

// The "Hol tart" filter value from the query string, or null.
export function parseStage(params: URLSearchParams): Stage | null {
  const value = params.get("stage") ?? "";
  return isStage(value) ? value : null;
}

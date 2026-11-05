// Substitutes (spec 4 "Substitute", spec 11, #37, D109): who may stand in for
// an absent player in one match, when, and who then counts as having played.
// Pure; the requests live in match_substitutes (app/lib/substitutes.server.ts).

import type { EloSide } from "./elo";

export type SubstituteStatus = "requested" | "approved" | "rejected" | "withdrawn" | "revoked";

/** A request still in play: waiting for the organizer, or approved. */
export const LIVE_SUBSTITUTE: readonly SubstituteStatus[] = ["requested", "approved"];

export function isLiveSubstitute(status: SubstituteStatus): boolean {
  return LIVE_SUBSTITUTE.includes(status);
}

/**
 * The two players who actually played for a side: an approved substitute
 * takes the absent player's place (spec 11: Elo is computed from who played).
 * `approved`: absent player id -> substitute id, approved rows of the match.
 */
export function playedBy(players: EloSide, approved: ReadonlyMap<string, string>): EloSide {
  return [approved.get(players[0]) ?? players[0], approved.get(players[1]) ?? players[1]];
}

/**
 * When asking for (and approving or revoking) a substitute closes: the
 * agreed start of the match, or its deadline while no time is agreed.
 */
export function substituteClosesAt(m: { scheduledAt: Date | null; deadline: Date }): Date {
  return m.scheduledAt ?? m.deadline;
}

/** Whether the window is still open: before the start, and no result yet. */
export function substituteOpen(m: { closesAt: Date; hasResult: boolean; voided: boolean }, now: Date): boolean {
  return !m.voided && !m.hasResult && now.getTime() < m.closesAt.getTime();
}

export type SubstituteRefusal =
  // The match started, has a result, or doesn't count (withdrawal).
  | "closed"
  // The absent player is not one of the asking pair.
  | "not_absent"
  // That absent player already has a request waiting or approved.
  | "already"
  // The substitute plays in this match.
  | "match_player"
  // The substitute plays in another (not withdrawn) pair of the group.
  | "group_player"
  // Not a registered account of the league (or deleted).
  | "not_registered"
  // The substitute is already named on this match.
  | "taken"
  // Only a waiting request can be approved or rejected.
  | "not_requested"
  // Only an approved one can be revoked.
  | "not_approved"
  // Only the player who asked can withdraw a request.
  | "not_requester";

export interface SubstituteCheck {
  /** substituteOpen() for the match now. */
  readonly open: boolean;
  /** The four players of the match. */
  readonly matchPlayers: readonly string[];
  /** The players of the group's pairs that are not withdrawn. */
  readonly groupPlayers: ReadonlySet<string>;
  /** The substitute is a registered, not deleted player of the league. */
  readonly registered: boolean;
  readonly substituteId: string;
  /** The live requests of the match, except the one being decided. */
  readonly live: readonly { absentId: string; substituteId: string }[];
}

// What a substitute must be at request and at approval (spec 4): not one of
// the four, not in another pair of the group, registered, not named twice.
function substituteRefusal(c: SubstituteCheck): SubstituteRefusal | null {
  if (c.matchPlayers.includes(c.substituteId)) return "match_player";
  if (c.groupPlayers.has(c.substituteId)) return "group_player";
  if (!c.registered) return "not_registered";
  if (c.live.some((l) => l.substituteId === c.substituteId)) return "taken";
  return null;
}

/** Why a player of `pair` can't ask for this substitute now, or null. */
export function requestRefusal(c: SubstituteCheck & { pair: readonly string[]; absentId: string }): SubstituteRefusal | null {
  if (!c.open) return "closed";
  if (!c.pair.includes(c.absentId)) return "not_absent";
  if (c.live.some((l) => l.absentId === c.absentId)) return "already";
  return substituteRefusal(c);
}

/** Why the organizer can't approve this request now, or null. */
export function approvalRefusal(c: SubstituteCheck & { status: SubstituteStatus }): SubstituteRefusal | null {
  if (c.status !== "requested") return "not_requested";
  if (!c.open) return "closed";
  return substituteRefusal(c);
}

/** Why the organizer can't reject this request, or null. A late one can still be turned down. */
export function rejectionRefusal(status: SubstituteStatus): SubstituteRefusal | null {
  return status === "requested" ? null : "not_requested";
}

/** Why the organizer can't revoke this approval now, or null: only until the match starts. */
export function revocationRefusal(status: SubstituteStatus, open: boolean): SubstituteRefusal | null {
  if (status !== "approved") return "not_approved";
  return open ? null : "closed";
}

/** Why the asking player can't withdraw this request, or null: only their own, while it waits. */
export function withdrawalRefusal(r: { status: SubstituteStatus; requestedBy: string | null }, userId: string): SubstituteRefusal | null {
  if (r.status !== "requested") return "not_requested";
  return r.requestedBy === userId ? null : "not_requester";
}

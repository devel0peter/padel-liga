// No-shows (#33, spec 8, D108): the Hungarian texts. The rules are in
// packages/rules (no-show.ts); the reports and decisions in
// no-shows.server.ts.
import type { NoShowRefusal } from "@padel-liga/rules";

// The organizer's optional reason for a confirmation or a rejection.
export const NO_SHOW_REASON_MAX = 300;

export const NO_SHOW_REFUSALS: Record<NoShowRefusal, string> = {
  voided: "Ez a meccs nem számít: az egyik pár visszalépett a körből.",
  not_scheduled: "Csak lefixált időpontú, még eredmény nélküli meccsnél jelezheted, hogy nem jöttek el.",
  too_early: "Csak a meccs kezdete után jelezheted, hogy nem jöttek el.",
  too_late: "Lezárult a kör, erről a meccsről már nem lehet bejelentést tenni.",
  already: "Erre a meccsre már van bejelentés, a szervező dönt róla.",
  not_open: "Ez a bejelentés már nem vár döntésre.",
  not_reporter: "Csak az vonhatja vissza a bejelentést, aki beadta.",
  final: "A meccs már lezárult. Ha kell, lent felülbírálhatod a kimenetelét.",
};

export const NO_SHOW_CHANGED = "Közben változott a meccs vagy a bejelentés. Nézd meg újra, és próbáld még egyszer.";

// The ruling's reason in the match log (both pairs see it), with the
// organizer's own words when they gave any.
export function noShowDecisionReason(reason: string): string {
  const base = "Nem jöttek el: a szervező jóváhagyta a bejelentést";
  return reason ? `${base}. ${reason}` : `${base}.`;
}

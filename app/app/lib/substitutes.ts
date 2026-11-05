// Substitutes (#37, spec 4, D109): the Hungarian texts. The rules are in
// packages/rules (substitutes.ts); the requests and decisions in
// substitutes.server.ts.
import type { SubstituteRefusal, SubstituteStatus } from "@padel-liga/rules";

// The organizer's optional reason for a rejection or a revocation.
export const SUBSTITUTE_REASON_MAX = 300;

export const SUBSTITUTE_REFUSALS: Record<SubstituteRefusal, string> = {
  closed: "Erre a meccsre már nem lehet helyettest kérni: elkezdődött, van eredménye, vagy nem számít.",
  not_absent: "Csak a saját párod egyik játékosa helyett kérhetsz helyettest.",
  already: "Ő helyette már van helyettes kérés.",
  match_player: "A helyettes nem játszhat ezen a meccsen egyik párban sem.",
  group_player: "A helyettes nem játszhat másik párban ebben a csoportban.",
  not_registered: "A helyettesnek regisztrált játékosnak kell lennie ebben a ligában.",
  taken: "Őt már megnevezték helyettesnek ezen a meccsen.",
  not_requested: "Ez a kérés már nem vár döntésre.",
  not_approved: "Csak jóváhagyott helyettest lehet visszavonni.",
  not_requester: "Csak az vonhatja vissza a kérést, aki beadta.",
};

export const SUBSTITUTE_CHANGED = "Közben változott a meccs vagy a kérés. Nézd meg újra, és próbáld még egyszer.";

// The status of a request, as the pair and the organizer see it. A waiting
// request whose match started without a decision lapsed.
export function substituteStatusLabel(status: SubstituteStatus, open: boolean): string {
  switch (status) {
    case "requested":
      return open ? "Jóváhagyásra vár" : "Lejárt, nem döntöttek róla";
    case "approved":
      return "Jóváhagyva";
    case "rejected":
      return "Elutasítva";
    case "withdrawn":
      return "Visszavontátok";
    case "revoked":
      return "A szervező visszavonta";
  }
}

// "Kiss Anna helyett Nagy Béla"
export const substituteLine = (s: { absent: string; substitute: string }) => `${s.absent} helyett ${s.substitute}`;

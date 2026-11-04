// Which leagues a registered player belongs to (D73, D93). Pure, so the rule
// is unit tested once and every reader uses the same one: Párok's players
// without a pair (and what is built from them: the counts, "Levél nekik",
// "Pár létrehozása") and the stuck reminders.
//
// Accounts have no city of their own. An address with interest signups
// (as email1 or email2, withdrawn ones too: they still say where) belongs to
// the leagues of those signups' cities; signups only in cities without a
// league ("Más város") mean no league. An address without a signup belongs to
// every league: open sign-up happens on a league city's page. Staff accounts
// (Admin, Szervező) follow the same rule. A real account city or league
// choice would replace this.

export type CitySignup = { email1: string; email2: string | null; city: string };

// The cities of each address's signups, by lowercased address.
export type SignupCities = ReadonlyMap<string, ReadonlySet<string>>;

export function signupCities(signups: readonly CitySignup[]): SignupCities {
  const out = new Map<string, Set<string>>();
  for (const s of signups)
    for (const email of [s.email1, s.email2]) {
      if (!email) continue;
      const key = email.toLowerCase();
      if (!out.has(key)) out.set(key, new Set());
      out.get(key)!.add(s.city);
    }
  return out;
}

// Whether the account with this address belongs to the leagues of `city`.
export function inLeagueCity(cities: SignupCities, email: string, city: string): boolean {
  const own = cities.get(email.toLowerCase());
  return !own || own.has(city);
}

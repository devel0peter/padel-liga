// Who a broadcast goes to. Pure (no I/O). Since the interest list's flows
// went (#333, D129) the only audience is "Levél nekik" on Párok: the players
// of the rows it shows (league-pairs-view.server.ts, D64).

export type Recipient = { email: string; name: string };

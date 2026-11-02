// More matches than one D1 statement can bind (100 parameters), for the
// tests of lists that look matches up by id (#28, #29). Each match is in its
// own published group of season 1, between two pairs of its own.
type Raw = { exec(sql: string): void; prepare(sql: string): { run(...params: unknown[]): unknown } };

export const MANY = 110;

/** Adds MANY matches of league 1, season 1, phase 1; returns their ids. */
export function addManyMatches(raw: Raw, deadline: Date, firstId = 5000): number[] {
  const user = raw.prepare("insert into users (id, email, name, level, consent_at) values (?, ?, ?, 'halado', 1)");
  const pair = raw.prepare("insert into pairs (id, league_id, player_a, player_b) values (?, 1, ?, ?)");
  const group = raw.prepare("insert into groups (id, season_id, phase, number, published_at) values (?, 1, 1, ?, 1)");
  const match = raw.prepare("insert into matches (id, group_id, pair_a, pair_b, week, deadline) values (?, ?, ?, ?, 1, ?)");
  const ids: number[] = [];
  for (let i = 0; i < MANY; i++) {
    const id = firstId + i;
    for (const p of [2 * id, 2 * id + 1]) {
      user.run(`m${p}a`, `m${p}a@x.hu`, `Sok ${p}A`);
      user.run(`m${p}b`, `m${p}b@x.hu`, `Sok ${p}B`);
      pair.run(p, `m${p}a`, `m${p}b`);
    }
    group.run(id, 100 + i);
    match.run(id, id, 2 * id, 2 * id + 1, Math.floor(deadline.getTime() / 1000));
    ids.push(id);
  }
  return ids;
}

/** Pair A of match `id` (from addManyMatches) records `score` at `at`. */
export function recordOn(raw: Raw, id: number, score: unknown, at: Date): void {
  raw
    .prepare("insert into match_events (match_id, pair_id, user_id, kind, score, at) values (?, ?, ?, 'result_recorded', ?, ?)")
    .run(id, 2 * id, `m${2 * id}a`, JSON.stringify(score), Math.floor(at.getTime() / 1000));
  raw.prepare("update matches set status = 'result_pending' where id = ?").run(id);
}

// The running-season seed, pure parts: the plan follows the league's own
// rules (fixtures, slot rules, scores, scheduling and result states), and the
// SQL starts with the walkthrough seed's reset and touches only fake rows.
import { describe, expect, it } from "vitest";

import {
  addDays,
  agreedTimeErrors,
  budapestDay,
  isMonday,
  proposalErrors,
  resultState,
  schedulingState,
  validateScore,
  type ResultEvent,
  type SchedulingEvent,
} from "@padel-liga/rules";

import { resetStatements, SEED_EMAIL_DOMAIN } from "./seed";
import { runningStart, SEASON_GROUPS, seasonElo, seasonPairs, seasonPlan, seasonSeedSql, seasonStatements } from "./seed-season";

// Saturday 2026-11-07 and every other weekday of that week, at two times of day.
const NOWS = [0, 1, 2, 3, 4, 5, 6].flatMap((d) =>
  ["T00:30:00Z", "T21:30:00Z"].map((t) => new Date(`${addDays("2026-11-02", d)}${t}`)),
);
const NOW = new Date("2026-11-07T10:00:00Z");

const SCHEDULING = new Set(["proposal", "counter_proposal", "accepted", "agreed_time", "agreed_confirmed", "venue"]);

describe("runningStart", () => {
  it.each(NOWS)("is a Monday with %s in week 2 of phase 1", (now) => {
    const start = runningStart(now);
    expect(isMonday(start)).toBe(true);
    const today = budapestDay(now);
    expect(today >= addDays(start, 7) && today <= addDays(start, 13)).toBe(true);
  });
});

describe("seasonPlan", () => {
  it("puts 11 distinct pairs in groups of 4, 4 and 3 with every round-robin fixture", () => {
    const plan = seasonPlan(NOW);
    const emails = plan.pairs.flatMap((p) => [p.a.email, p.b.email]);
    expect(plan.pairs).toHaveLength(11);
    expect(new Set(emails).size).toBe(22);
    expect(emails.every((e) => e.endsWith(`@${SEED_EMAIL_DOMAIN}`))).toBe(true);
    expect(SEASON_GROUPS.map((g) => g.length)).toEqual([4, 4, 3]);
    expect(SEASON_GROUPS.flat().sort((x, y) => x - y)).toEqual(seasonPairs().map((_, i) => i));
    expect(plan.fixtures).toHaveLength(6 + 6 + 3);
    for (const g of [0, 1, 2]) for (const w of [1, 2, 3]) expect(plan.fixtures.some(([fg, fw]) => fg === g && fw === w)).toBe(true);
  });

  it("gives a log only to real fixtures, each at most once", () => {
    const plan = seasonPlan(NOW);
    const keys = plan.matches.map((m) => `${m.a}-${m.b}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of plan.matches) expect(plan.fixtures.some(([, , a, b]) => a === m.a && b === m.b)).toBe(true);
  });

  it("covers every match state", () => {
    const statuses = new Set(seasonPlan(NOW).matches.map((m) => m.status));
    expect([...statuses].sort()).toEqual(["disputed", "final", "open", "result_pending", "scheduled"]);
  });

  it.each(NOWS)("at %s: proposals and agreed times follow the slot rules, and every log is in order", (now) => {
    const plan = seasonPlan(now);
    const deadline = plan.phases[0]!.deadline;
    for (const m of plan.matches) {
      m.events.forEach((e, i) => {
        if (i > 0) expect(e.at.getTime()).toBeGreaterThanOrEqual(m.events[i - 1]!.at.getTime());
        expect(e.at.getTime()).toBeLessThanOrEqual(now.getTime());
        if (e.kind === "proposal" || e.kind === "counter_proposal") expect(proposalErrors(e.ranges!, e.at, deadline)).toEqual([]);
        if (e.kind === "agreed_time") expect(agreedTimeErrors(e.slot!, e.at, deadline)).toEqual([]);
      });
    }
  });

  it.each(NOWS)("at %s: each match's status and venue mirror its log, as the app keeps them", (now) => {
    for (const m of seasonPlan(now).matches) {
      const scheduling = schedulingState(
        m.events.filter((e) => SCHEDULING.has(e.kind)).map((e) => ({ ...e, clubId: e.club ? 1 : null }) as SchedulingEvent),
        now,
      );
      const result = resultState(m.events.filter((e) => e.kind.startsWith("result_")) as ResultEvent[]);
      const expected =
        result.status === "recorded"
          ? "result_pending"
          : result.status === "none"
            ? scheduling.status === "scheduled"
              ? "scheduled"
              : "open"
            : result.status;
      expect(m.status, `${m.a}-${m.b}`).toBe(expected);
      if (result.status === "final") expect(m.outcome).toEqual(result.outcome);
      else expect(m.outcome).toBeUndefined();
      if (scheduling.status === "scheduled") expect(m.scheduledAt).toEqual(scheduling.slot);
      if (m.status === "open") expect(m.scheduledAt).toBeUndefined();
    }
  });

  it("records only valid scores", () => {
    for (const m of seasonPlan(NOW).matches)
      for (const e of m.events) if (e.score) expect(validateScore(e.score).ok, `${m.a}-${m.b} ${e.kind}`).toBe(true);
  });
});

describe("seasonElo: the seed's Élő-pont, as updateElo would leave it", () => {
  it("rates every final played match, two changes a side, and moves the winners up", () => {
    const plan = seasonPlan(NOW);
    const finals = plan.matches.filter((m) => m.status === "final").length;
    const { changes, players } = seasonElo(plan);
    expect(finals).toBeGreaterThan(0);
    expect(changes).toHaveLength(finals * 4);
    for (const c of changes) expect(c.after - c.before).toBeCloseTo(c.delta, 9);
    expect(changes.some((c) => c.delta > 0) && changes.some((c) => c.delta < 0)).toBe(true);
    expect(players.size).toBeGreaterThan(0);
  });

  it("writes the changes and the ratings", () => {
    const statements = seasonStatements(NOW);
    const { changes, players } = seasonElo(seasonPlan(NOW));
    expect(statements.filter((s) => s.startsWith("insert into elo_changes"))).toHaveLength(changes.length);
    expect(statements.filter((s) => s.startsWith("update users set elo ="))).toHaveLength(players.size);
  });
});

describe("seasonSeedSql", () => {
  it("starts with the walkthrough seed's reset", () => {
    const sql = seasonSeedSql(NOW);
    expect(sql.startsWith(`${resetStatements()[0]};`)).toBe(true);
  });

  it("writes only fake accounts and no delete outside the reset", () => {
    const statements = seasonStatements(NOW);
    for (const s of statements.filter((s) => s.startsWith("insert into users")))
      expect(s).toMatch(new RegExp(`'[^']+@${SEED_EMAIL_DOMAIN.replace(".", "\\.")}'`));
    const deletes = statements.filter((s) => s.startsWith("delete"));
    expect(deletes).toEqual([expect.stringMatching(/^delete from season_phases where season_id = \(select s\.id from seasons s join leagues l/)]);
  });
});

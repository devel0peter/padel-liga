import { deleteStaleLoginCodes, STALE_CODE_BATCH } from "~/lib/auth/login-code.server";
import { resolveDeadlines } from "~/lib/deadline.server";
import { DELIVER_MIN, deliver } from "~/lib/email/outbox.server";
import { PURGE_MIN, purgeInterestList } from "~/lib/interest-list-purge.server";
import { beginInvocation, logError, logInfo, logWarn } from "~/lib/log";
import { runMatchReminders } from "~/lib/match-reminders.server";
import { pushQueued } from "~/lib/notifications.server";
import { PUSH_STATS_QUERIES, recordPushStats } from "~/lib/push-stats.server";
import { queueDueReminders, STUCK_QUERIES } from "~/lib/reminders.server";
import { autoAcceptResults } from "~/lib/results.server";
import { autoFixAgreedTimes } from "~/lib/agreed-auto-fix.server";
import { draftRoundSwitches } from "~/lib/round-switch.server";
import { RunBudget, type Usage } from "~/lib/run-usage";

// The cron, every 10 minutes (workers/app.ts, app/wrangler.jsonc; #183,
// #185, #188). The steps run one after the other, in this order, each from
// the run's scheduled time: stale login code records are deleted (#168),
// results waiting 48 hours are accepted (#28), from 06:00 the morning after a
// phase's deadline its unplayed matches are resolved and the strikes given
// (#11, #294, deadline.server.ts), and once they are settled the next phase's
// groups drafted for the organizer (#35, round-switch.server.ts), agreed
// times nobody answered fixed (D148, agreed-auto-fix.server.ts), the match reminders and the
// daily digest when their hour comes (#31), the reminders for people stuck
// before entering (#155), the one-time deletion of the interest list until it
// is done (#334, interest-list-purge.server.ts; before the delivery, so none
// of its waiting mail goes out), then the queued pushes and whatever email waits,
// and last the day's push count (push-stats.server.ts, D100) when the run has
// a query left. A step that fails is logged under its own name and the next
// one runs anyway.
//
// One run may make 50 D1 queries and 50 outgoing calls (Workers Free,
// lib/run-usage.ts). The steps share one budget; each keeps enough of it for
// the steps after it, and what doesn't fit is left for the next run, logged.

export type CronStep = {
  name: string;
  // What the step did, for the log; nothing when there was nothing to do.
  run: (now: Date, budget: RunBudget) => Promise<string | null>;
};

const plus = (a: Usage, b: Usage): Usage => ({ queries: a.queries + b.queries, calls: a.calls + b.calls });

// What pushQueued needs for one round (the queue, the devices, the claim,
// gone devices, what's left) and one push.
const PUSH_MIN: Usage = { queries: 5, calls: 1 };
const AFTER_PURGE = plus(PUSH_MIN, DELIVER_MIN);
const AFTER_STUCK = plus(PURGE_MIN, AFTER_PURGE);
const AFTER_MATCH = plus({ queries: STUCK_QUERIES, calls: 0 }, AFTER_STUCK);
// The match reminders' own lookups (running matches and one batch), so a
// long deadline run never starves them.
const AFTER_DEADLINE = plus({ queries: 6, calls: 0 }, AFTER_MATCH);

export const CRON_STEPS: readonly CronStep[] = [
  {
    // One query (login-code.server.ts), first so that it runs every run
    // however much the others have to do: email delivery uses what is left.
    name: "login code cleanup",
    run: async (now, run) => {
      if (!run.fits({ queries: 1 })) return "login code cleanup: no room in this run; left for the next one";
      const n = await deleteStaleLoginCodes(now);
      if (n === STALE_CODE_BATCH) return `deleted ${n} stale login codes; any more left for the next run`;
      return n ? `deleted ${n} stale login codes` : null;
    },
  },
  {
    // Up to AUTO_ACCEPT_BATCH results, then one Elo replay when any was
    // accepted (ELO_REPLAY_QUERIES, more on a retry; #13). The later steps
    // check what is left with fits().
    name: "auto-accept",
    run: async (now) => {
      const n = await autoAcceptResults(now);
      return n ? `auto-accepted ${n} results` : null;
    },
  },
  {
    name: "deadline resolution",
    run: async (now, run) => {
      const { resolved, left } = await resolveDeadlines(now, { run, keep: AFTER_DEADLINE });
      if (left) return `resolved ${resolved} matches at the deadline; more left for the next run`;
      return resolved ? `resolved ${resolved} matches at the deadline` : null;
    },
  },
  {
    // After the resolution, so the draft reads settled tables; it waits for
    // a run where no match of the ending phase is left to resolve. Keeps the
    // same room for the steps after it as the resolution does.
    name: "round switch draft",
    run: (now, run) => draftRoundSwitches(now, { run, keep: AFTER_DEADLINE }),
  },
  {
    // After the resolution and the draft, so it never takes their room (the
    // resolution reads the same state from the log either way); it writes
    // the line and mirrors the match, keeping the match reminders' room.
    name: "agreed time auto-fix",
    run: async (now, run) => {
      const { fixed, left } = await autoFixAgreedTimes(now, { run, keep: AFTER_MATCH });
      if (left) return `fixed ${fixed} agreed times; more left for the next run`;
      return fixed ? `fixed ${fixed} agreed times` : null;
    },
  },
  {
    name: "match reminders",
    run: (now, run) => runMatchReminders(now, { run, keep: AFTER_MATCH }),
  },
  {
    name: "stuck reminders",
    run: async (now, run) => {
      if (!run.fits(plus({ queries: STUCK_QUERIES, calls: 0 }, AFTER_STUCK))) return "stuck reminders: no room in this run; left for the next one";
      const n = await queueDueReminders(now);
      return n ? `queued ${n} reminders` : null;
    },
  },
  {
    // Chunks while the run has room beyond what delivery needs; a query a
    // run until it sees the done mark, then none (#334).
    name: "interest list deletion",
    run: (now, run) => purgeInterestList(now, { run, keep: AFTER_PURGE }),
  },
  {
    name: "push delivery",
    run: async (_now, run) => {
      const { pushed, left } = await pushQueued(run, DELIVER_MIN);
      if (left) return `pushed ${pushed} notifications; ${left} left for the next run (run limits)`;
      return pushed ? `pushed ${pushed} notifications` : null;
    },
  },
  {
    name: "email delivery",
    run: async (now, run) => {
      if (!run.fits(DELIVER_MIN)) return "email delivery: no room in this run; left for the next one";
      const { sent, left } = await deliver(undefined, now, run);
      if (left) return `sent ${sent} emails; ${left} left for the next run (run limits)`;
      return sent ? `sent ${sent} emails` : null;
    },
  },
  {
    // Last, so it never takes room from a delivery; a skipped run is fine,
    // the next one of the day writes the same row.
    name: "push stats",
    run: async (now, run) => {
      if (!run.fits({ queries: PUSH_STATS_QUERIES })) return "push stats: no room in this run; left for the next one";
      await recordPushStats(now);
      return null;
    },
  },
];

// Work a step left for the next run says so in its result.
const DEFERRED = /left for the next/;

// The run's log (#227): a start and a finish line, one line per step that did
// something (a warning when it left work for the next run), and an error line
// per failed step, all with the run's request id.
export async function runCron(now: Date, steps: readonly CronStep[] = CRON_STEPS): Promise<void> {
  const requestId = `cron-${crypto.randomUUID()}`;
  const end = beginInvocation(requestId, "cron");
  const started = Date.now();
  const budget = new RunBudget();
  let failed = 0;
  logInfo("cron start", { requestId, scheduled: now });
  try {
    for (const step of steps) {
      try {
        const done = await step.run(now, budget);
        if (done) (DEFERRED.test(done) ? logWarn : logInfo)("cron step", { requestId, step: step.name, result: done });
      } catch (error) {
        failed++;
        logError("cron step failed", { requestId, step: step.name, error });
      }
    }
  } finally {
    logInfo("cron finish", { requestId, ms: Date.now() - started, failed, ...budget.used() });
    end();
  }
}

import { deliver } from "~/lib/email/outbox.server";
import { runMatchReminders } from "~/lib/match-reminders.server";
import { queueDueReminders } from "~/lib/reminders.server";
import { autoAcceptResults } from "~/lib/results.server";

// The hourly cron (workers/app.ts, #185, #188). The steps run one after the
// other, in this order, each from the run's scheduled time: results waiting
// 48 hours are accepted (#28), then the match reminders and the daily digest
// when their hour comes (#31), the reminders for people stuck before entering
// (#155), and last whatever email waits. A step that fails is logged under its
// own name and the next one runs anyway.

export type HourlyStep = {
  name: string;
  // What the step did, for the log; nothing when there was nothing to do.
  run: (now: Date) => Promise<string | null>;
};

export const HOURLY_STEPS: readonly HourlyStep[] = [
  {
    name: "auto-accept",
    run: async (now) => {
      const n = await autoAcceptResults(now);
      return n ? `auto-accepted ${n} results` : null;
    },
  },
  {
    name: "match reminders",
    run: async (now) => {
      await runMatchReminders(now);
      return null;
    },
  },
  {
    name: "stuck reminders",
    run: async (now) => {
      const n = await queueDueReminders(now);
      return n ? `queued ${n} reminders` : null;
    },
  },
  {
    name: "email delivery",
    run: async (now) => {
      const { sent } = await deliver(undefined, now);
      return sent ? `sent ${sent} emails` : null;
    },
  },
];

export async function runHourlyJob(now: Date, steps: readonly HourlyStep[] = HOURLY_STEPS): Promise<void> {
  for (const step of steps) {
    try {
      const done = await step.run(now);
      if (done) console.log(`cron: ${done}`);
    } catch (error) {
      console.error(`cron: ${step.name} failed`, error);
    }
  }
}

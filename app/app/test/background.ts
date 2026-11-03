// For server-module tests: stands in for ~/lib/background.server. Work that
// would run after the response (#140) is collected here instead, so a test
// can check what the request did on its own and then let the rest finish:
//
//   vi.mock("~/lib/background.server", () => import("~/test/background"));
//   import { settleBackground } from "~/test/background";
//   await O.queueRegistrationInvites();   // nothing sent yet
//   await settleBackground();             // now the background send ran
//
// Not a test file itself; only imported by tests.

const tasks: Promise<unknown>[] = [];

export function runAfterResponse(_label: string, task: () => Promise<unknown>): void {
  tasks.push(task());
}

// How many background tasks are queued and not awaited yet.
export function backgroundPending(): number {
  return tasks.length;
}

// Awaits every background task, including ones they start themselves.
export async function settleBackground(): Promise<void> {
  while (tasks.length > 0) await tasks.shift();
}

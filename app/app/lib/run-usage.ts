// What a run of the Worker has used of the Workers Free limits (#183): 50
// database queries (a D1 batch counts as one) and 50 outgoing calls (each
// push to a device, each Resend request, each relay connection) per
// invocation. The D1 client counts the queries (db/client.server.ts, and the
// test database in test/sqlite.ts), the senders count their calls. The
// counters belong to the isolate, so a request served alongside a cron run
// counts too: the run then stops early, never late.
// https://developers.cloudflare.com/workers/platform/limits/

export type Usage = { queries: number; calls: number };

export const RUN_LIMITS: Readonly<Usage> = { queries: 50, calls: 50 };

const used: Usage = { queries: 0, calls: 0 };

export function countQuery(): void {
  used.queries++;
}

export function countCall(): void {
  used.calls++;
}

/** What one run may still use: the limits less what it used since it started. */
export class RunBudget {
  private readonly start: Usage = { ...used };

  constructor(private readonly limits: Readonly<Usage> = RUN_LIMITS) {}

  used(): Usage {
    return { queries: used.queries - this.start.queries, calls: used.calls - this.start.calls };
  }

  left(): Usage {
    const u = this.used();
    return { queries: this.limits.queries - u.queries, calls: this.limits.calls - u.calls };
  }

  /** Whether work that costs this much still fits. */
  fits(cost: Partial<Usage>): boolean {
    const left = this.left();
    return (cost.queries ?? 0) <= left.queries && (cost.calls ?? 0) <= left.calls;
  }
}

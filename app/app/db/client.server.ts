import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import { countQuery } from "~/lib/run-usage";

import * as schema from "./schema";

// Every query a run makes counts against its Workers Free limit (#183,
// lib/run-usage.ts): a statement when it runs, a batch once (as D1 counts it).
// The binding gets its own statements back, so a batch sees real ones.
// The binding is read on each access, never at import: Cloudflare runs the
// global scope without bindings when it validates an upload (#234).
const originals = new WeakMap<object, D1PreparedStatement>();
const RUNS = new Set<PropertyKey>(["run", "all", "raw", "first"]);

function counted(statement: D1PreparedStatement): D1PreparedStatement {
  const proxy = new Proxy(statement, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "bind") return (...args: unknown[]) => counted(value.apply(target, args));
      if (RUNS.has(prop))
        return (...args: unknown[]) => {
          countQuery();
          return value.apply(target, args);
        };
      return value.bind(target);
    },
  });
  originals.set(proxy, statement);
  return proxy;
}

export function countedDatabase(binding: () => D1Database): D1Database {
  return new Proxy({} as D1Database, {
    get(_, prop) {
      const target = binding();
      const value = Reflect.get(target, prop, target);
      if (typeof value !== "function") return value;
      if (prop === "prepare") return (query: string) => counted(value.call(target, query));
      if (prop === "batch")
        return (statements: D1PreparedStatement[]) => {
          countQuery();
          return value.call(
            target,
            statements.map((s) => originals.get(s) ?? s),
          );
        };
      return value.bind(target);
    },
  });
}

export const db = drizzle(countedDatabase(() => env.DB), { schema });

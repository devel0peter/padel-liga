// The route table (routes.ts): which paths exist. A path no route matches is
// the app's 404 page.
import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import routes from "./routes";

type Entry = { path?: string; index?: boolean; file: string; children?: Entry[] };

const toObjects = (entries: readonly Entry[]): RouteObject[] =>
  entries.map((e) =>
    e.index ? { index: true, path: e.path, id: e.file } : { path: e.path, id: e.file, children: e.children ? toObjects(e.children) : undefined },
  );

const fileFor = (path: string) => matchRoutes(toObjects(routes as Entry[]), path)?.at(-1)?.route.id ?? null;

describe("routes", () => {
  it("serves /pair and the organizer's Párok page (#97)", () => {
    expect(fileFor("/pair")).toBe("routes/pair.tsx");
    expect(fileFor("/admin/leagues/gyor/pairs")).toBe("routes/admin.league-pairs.tsx");
  });

  it("has no pair invite page any more: /pair/invite/<token> is a 404 (#97)", () => {
    expect(fileFor("/pair/invite/" + "a".repeat(43))).toBeNull();
  });
});

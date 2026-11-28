import { describe, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ env: {} }));
import routes from "../routes";
const { ORGANIZER_GUIDE_SECTIONS } = await import("./admin.league-help");

type RouteNode = { path?: string; index?: boolean; children?: RouteNode[] };

function collectPatterns(nodes: readonly RouteNode[], prefix = ""): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    const seg = n.path ? (n.path.startsWith("/") ? n.path : `${prefix}/${n.path}`) : prefix;
    const normalized = seg.replace(/\/+/g, "/") || "/";
    if (n.index || (!n.children && n.path)) out.push(normalized);
    if (n.children) out.push(...collectPatterns(n.children, normalized === "/" ? "" : normalized));
  }
  return out;
}

function matchesPattern(pathname: string, pattern: string): boolean {
  const pathParts = pathname.split("/").filter(Boolean);
  const patParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patParts.length) return false;
  return patParts.every((p, i) => p.startsWith(":") || p === pathParts[i]);
}

describe("organizer help guide links (#386)", () => {
  it("every link in ORGANIZER_GUIDE_SECTIONS matches a real route in routes.ts", () => {
    const patterns = collectPatterns(routes as unknown as RouteNode[]);
    const links = ORGANIZER_GUIDE_SECTIONS.flatMap((s) => s.steps.flatMap((st) => st.links));
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      const href = link.path("gyor");
      const pathname = href.split("?")[0]!.split("#")[0]!;
      const matched = patterns.some((p) => matchesPattern(pathname, p));
      expect(matched, `Route not found for "${link.label}" -> ${href}`).toBe(true);
    }
  });
});

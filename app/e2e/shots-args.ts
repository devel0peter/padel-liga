// The pure part of `npm run e2e:shots` (#103): reading its command line and
// naming the screenshots. No I/O, so a spec can test it without a browser.

export const ROLES = ["anon", "player", "organizer", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const DATA_MODES = ["seed", "walked"] as const;
export type DataMode = (typeof DATA_MODES)[number];

export const WIDTHS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } } as const;
export type Size = keyof typeof WIDTHS;

export type ShotsArgs = {
  // seed: a fresh D1 with the #90 seed (the "empty" state). walked: the state
  // the last `npm run e2e` left (the "filled" state).
  data: DataMode;
  roles: Role[];
  // The accessible name of a button or link to click once on every page.
  click: string | null;
  // The folder name under app/e2e/.reports/shots/.
  label: string;
  // Local paths, e.g. /admin/leagues. Never a full URL.
  paths: string[];
};

export function parseShotsArgs(argv: readonly string[]): ShotsArgs {
  const out: ShotsArgs = { data: "seed", roles: [], click: null, label: "shots", paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined || v.startsWith("--")) throw new Error(`${a} needs a value.`);
      return v;
    };
    if (a === "--data") {
      const v = value();
      if (!(DATA_MODES as readonly string[]).includes(v)) throw new Error(`--data is one of ${DATA_MODES.join(", ")}, not ${v}.`);
      out.data = v as DataMode;
    } else if (a === "--as") {
      const v = value();
      if (!(ROLES as readonly string[]).includes(v)) throw new Error(`--as is one of ${ROLES.join(", ")}, not ${v}.`);
      if (!out.roles.includes(v as Role)) out.roles.push(v as Role);
    } else if (a === "--click") {
      out.click = value();
    } else if (a === "--label") {
      const v = value();
      if (!/^[\w-]{1,40}$/.test(v)) throw new Error("--label is letters, digits, - and _ only.");
      out.label = v;
    } else if (a.startsWith("--")) {
      throw new Error(`Unknown option ${a}.`);
    } else {
      out.paths.push(checkPath(a));
    }
  }
  if (out.paths.length === 0) throw new Error("Give at least one path, e.g. /admin/leagues.");
  if (out.roles.length === 0) out.roles.push("admin");
  // A seeded player has no account until the walkthrough has invited and
  // registered them (steps 3-6), which `npm run e2e` does.
  if (out.roles.includes("player") && out.data === "seed")
    throw new Error("--as player needs --data walked: in the seed the players have no account yet. Run `npm run e2e` first.");
  return out;
}

// Only this app, on the suite's own server: a path, never a URL or another host.
export function checkPath(p: string): string {
  if (!p.startsWith("/") || p.startsWith("//") || /[\s\\]/.test(p) || p.includes("://"))
    throw new Error(`Not a local path: ${p}. Use a path such as /admin/leagues.`);
  return p;
}

// `admin-admin-leagues-desktop.png`; `/` is `home`.
export function shotName(role: Role, path: string, size: Size | `${Size}-after-click`): string {
  const slug =
    path
      .replace(/^\/+/, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "home";
  return `${role}-${slug}-${size}.png`;
}

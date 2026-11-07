// Napló (#226, D91): the audit log page's filters and wording. Pure; the
// query is in audit-log.server.ts.
import { budapestTime, isDay, type Day } from "@padel-liga/rules";

import { DELETED_NAME } from "./account-deletion";
import { isSystemAction, SYSTEM_ACTOR } from "./audit";
import { STATUSES, type Status } from "./signups-admin";

export const LOG_PAGE_SIZE = 50;

// The actor filter's two values that aren't an account id.
export const SYSTEM = "system";
export const DELETED = "deleted";

export type LogFilters = {
  action: string | null;
  actor: string | null; // an account id, SYSTEM or DELETED
  league: number | null;
  from: Day | null; // Budapest days, both included
  to: Day | null;
  page: number; // from 1
};

// From the address (?action=&actor=&league=&from=&to=&page=). Anything
// malformed is ignored.
export function parseLogFilters(params: URLSearchParams): LogFilters {
  const text = (key: string) => params.get(key)?.trim() || null;
  const day = (key: string) => {
    const v = text(key);
    return v && isDay(v) ? v : null;
  };
  const league = Number(params.get("league"));
  const page = Number(params.get("page"));
  return {
    action: text("action"),
    actor: text("actor"),
    league: Number.isInteger(league) && league > 0 ? league : null,
    from: day("from"),
    to: day("to"),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

export function hasLogFilters(f: LogFilters): boolean {
  return !!(f.action || f.actor || f.league || f.from || f.to);
}

// The UTC bounds of the date filter: from 00:00 of `from` until 00:00 after `to`.
export function logBounds(f: Pick<LogFilters, "from" | "to">): { since: Date | null; before: Date | null } {
  const next = (day: Day) => {
    const d = new Date(`${day}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };
  return {
    since: f.from ? budapestTime(f.from, 0, 0) : null,
    before: f.to ? budapestTime(next(f.to), 0, 0) : null,
  };
}

// The address of another page of the same filtered list.
export function pageHref(params: URLSearchParams, page: number): string {
  const next = new URLSearchParams(params);
  if (page > 1) next.set("page", String(page));
  else next.delete("page");
  const q = next.toString();
  return q ? `?${q}` : "?";
}

// Who did it: the account's name, "Törölt játékos" for a deleted or
// anonymized one (never its old name), "Rendszer" for the cron and the
// command line.
export function actorLabel(actor: { name: string; deleted: boolean } | null, action: string): string {
  if (!actor) return isSystemAction(action) ? SYSTEM_ACTOR : DELETED_NAME;
  if (actor.deleted) return DELETED_NAME;
  return actor.name || "Névtelen";
}

// "kind:id" references in a target or detail, and bare account ids (older
// pair entries list the two players' ids).
const REF = /\b(user|pair|league|season|season_entry|club|city|match|signup|broadcast):([A-Za-z0-9_-]+)/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g;

export type Ref = { kind: string; id: string };

export function refsIn(text: string | null): Ref[] {
  if (!text) return [];
  const out: Ref[] = [];
  for (const m of text.matchAll(REF)) out.push({ kind: m[1]!, id: m[2]! });
  for (const m of text.replace(REF, "").matchAll(UUID)) out.push({ kind: "user", id: m[0] });
  return out;
}

export const refKey = (r: Ref) => `${r.kind}:${r.id}`;

const KIND_WORDS: Record<string, string> = {
  user: "Fiók",
  pair: "Pár",
  league: "Liga",
  season: "Szezon",
  season_entry: "Nevezés",
  club: "Klub",
  city: "Város",
  match: "Meccs",
  signup: "Jelentkezés",
  broadcast: "Körlevél",
};

// Text with every reference replaced by what it names ("pair:12" -> "Anna –
// Béla"); a reference nothing names any more by its kind and number
// ("Klub #3"). Ids never show.
export function renderRefs(text: string | null, names: ReadonlyMap<string, string>): string {
  if (!text) return "";
  const word = (kind: string, id: string) => names.get(`${kind}:${id}`) ?? (kind === "user" ? DELETED_NAME : `${KIND_WORDS[kind] ?? kind} #${id}`);
  return text.replace(REF, (_, kind: string, id: string) => word(kind, id)).replace(UUID, (id) => word("user", id));
}

// Details are stored as short English codes (audit.server.ts callers, and
// the rows before #225); Napló shows them in Hungarian.
const DETAIL_WORDS: [RegExp, string | ((...m: string[]) => string)][] = [
  [/^(\d+) pairs$/, "$1 pár"],
  [/(\d+) groups, (\d+) matches/, "$1 csoport, $2 meccs"],
  [/; (\d+) signups filed/, "; $1 jelentkezés átsorolva"],
  [/^(\d+) signups, (\d+) emails, (\d+) reminder records$/, "$1 jelentkezés, $2 levél, $3 emlékeztető-bejegyzés"],
  [/listed=true/, "listázva"],
  [/listed=false/, "nem listázva"],
  [/account deleted/, "fióktörlés miatt"],
  [/from (pair:\S+);/, "előtte: $1;"],
  [/ -> /g, " → "],
  [/ \+ /g, " és "],
  [/groups:([\d,]+)/, "csoport: $1"],
  [/; link:\d+/, "; párlinkkel"],
  [/^cli$/, "parancssor"],
  [/^invite(:\d+)?$/, "meghívó alapján"],
  [/status:(\w+)/, (_, s: string) => `állapot: ${Object.hasOwn(STATUSES, s) ? STATUSES[s as Status] : s}`],
  [/\bnote\b/, "megjegyzés"],
  [/(\d+) invites/, "$1 meghívó"],
  [/(\d+) recipients/, "$1 címzett"],
];

export function renderDetail(detail: string | null, names: ReadonlyMap<string, string>): string {
  if (!detail) return "";
  let text = detail;
  for (const [pattern, replacement] of DETAIL_WORDS) text = text.replace(pattern, replacement as string);
  return renderRefs(text, names);
}

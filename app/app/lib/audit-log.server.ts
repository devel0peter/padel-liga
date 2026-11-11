// Napló (#226, D91): one page of the audit log, newest first, with what each
// entry names looked up by id. Read-only: nothing here writes.
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "~/db/client.server";
import { auditLog, broadcasts, cities, clubs, leagues, pairs, seasonEntries, seasons, users } from "~/db/schema";

import { DELETED_NAME } from "./account-deletion";
import { actionLabel, AUDIT_ACTIONS, SYSTEM_ACTIONS, SYSTEM_ACTOR } from "./audit";
import {
  actorLabel,
  DELETED,
  LOG_PAGE_SIZE,
  logBounds,
  refKey,
  refsIn,
  renderDetail,
  renderRefs,
  SYSTEM,
  type LogFilters,
  type Ref,
} from "./audit-log";
import { chunks } from "./result-log.server";

export type LogRow = {
  id: number;
  at: Date;
  actor: string;
  // The accounts behind the actor and a "user:<id>" target, for the Admin's
  // links to their profiles (#301); null for the system or a deleted account.
  actorId: string | null;
  targetUserId: string | null;
  action: string;
  actionLabel: string;
  target: string;
  detail: string;
  league: string | null;
};

export type Option = { value: string; label: string };

export type LogPage = {
  rows: LogRow[];
  total: number;
  pages: number;
  options: { actions: Option[]; actors: Option[]; leagues: Option[] };
};

const actorUser = alias(users, "actor_user");

// The entries about one account (#301, the profile's Napló): written by it,
// naming it (target or detail), or about one of its pairs or their entries.
// Subqueries, not a list of ids (D1: at most 100 bound parameters).
function about(userId: string): SQL {
  const theirPairs = sql`select ${pairs.id} from ${pairs} where ${pairs.playerA} = ${userId} or ${pairs.playerB} = ${userId}`;
  return or(
    eq(auditLog.actorId, userId),
    eq(auditLog.target, `user:${userId}`),
    sql`instr(coalesce(${auditLog.detail}, ''), ${`user:${userId}`}) > 0`,
    sql`${auditLog.target} in (select 'pair:' || id from (${theirPairs}))`,
    sql`${auditLog.target} in (select 'season_entry:' || ${seasonEntries.id} from ${seasonEntries} where ${seasonEntries.pairId} in (${theirPairs}))`,
  )!;
}

function where(f: LogFilters): SQL | undefined {
  const { since, before } = logBounds(f);
  const system = SYSTEM_ACTIONS as string[];
  const actor =
    f.actor === SYSTEM
      ? and(isNull(auditLog.actorId), inArray(auditLog.action, system))
      : f.actor === DELETED
        ? or(and(isNull(auditLog.actorId), notInArray(auditLog.action, system)), isNotNull(actorUser.deletedAt))
        : f.actor
          ? eq(auditLog.actorId, f.actor)
          : undefined;
  return and(
    f.action ? eq(auditLog.action, f.action) : undefined,
    actor,
    f.person ? about(f.person) : undefined,
    f.league ? eq(auditLog.leagueId, f.league) : undefined,
    since ? gte(auditLog.at, since) : undefined,
    before ? lt(auditLog.at, before) : undefined,
  );
}

export async function auditLogPage(f: LogFilters): Promise<LogPage> {
  const condition = where(f);
  const [rows, [{ n }], actions, actors, leagueRows] = await Promise.all([
    db
      .select({
        id: auditLog.id,
        at: auditLog.at,
        actorId: auditLog.actorId,
        actorName: actorUser.name,
        actorDeleted: actorUser.deletedAt,
        action: auditLog.action,
        target: auditLog.target,
        detail: auditLog.detail,
        leagueId: auditLog.leagueId,
      })
      .from(auditLog)
      .leftJoin(actorUser, eq(actorUser.id, auditLog.actorId))
      .where(condition)
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(LOG_PAGE_SIZE)
      .offset((f.page - 1) * LOG_PAGE_SIZE),
    db.select({ n: count() }).from(auditLog).leftJoin(actorUser, eq(actorUser.id, auditLog.actorId)).where(condition),
    db.selectDistinct({ action: auditLog.action }).from(auditLog),
    db
      .selectDistinct({ id: actorUser.id, name: actorUser.name })
      .from(auditLog)
      .innerJoin(actorUser, eq(actorUser.id, auditLog.actorId))
      .where(isNull(actorUser.deletedAt)),
    db.select({ id: leagues.id, slug: leagues.slug, name: leagues.name }).from(leagues).orderBy(leagues.name),
  ]);

  const names = await namesOf(rows.flatMap((r) => [...refsIn(r.target), ...refsIn(r.detail), ...emailRefs(r.target)]), leagueRows);
  const leagueName = new Map(leagueRows.map((l) => [l.id, l.name]));
  return {
    rows: rows.map((r) => ({
      id: r.id,
      at: r.at,
      actor: actorLabel(r.actorId ? { name: r.actorName ?? "", deleted: !!r.actorDeleted } : null, r.action),
      actorId: r.actorId && !r.actorDeleted ? r.actorId : null,
      targetUserId: liveUser(r.target, names),
      action: r.action,
      actionLabel: actionLabel(r.action),
      target: renderTarget(r.target, names),
      detail: renderDetail(r.detail, names),
      league: r.leagueId ? (leagueName.get(r.leagueId) ?? null) : null,
    })),
    total: n,
    pages: Math.max(1, Math.ceil(n / LOG_PAGE_SIZE)),
    options: {
      actions: [...new Set([...Object.keys(AUDIT_ACTIONS), ...actions.map((a) => a.action)])]
        .map((value) => ({ value, label: actionLabel(value) }))
        .sort((a, b) => a.label.localeCompare(b.label, "hu")),
      actors: [
        { value: SYSTEM, label: SYSTEM_ACTOR },
        { value: DELETED, label: DELETED_NAME },
        ...actors
          .map((a) => ({ value: a.id!, label: a.name || "Névtelen" }))
          .sort((a, b) => a.label.localeCompare(b.label, "hu")),
      ],
      leagues: leagueRows.map((l) => ({ value: String(l.id), label: l.name })),
    },
  };
}

// Rows before #225 named accounts by email: the account's name if it still
// has one with that address (a deleted account's rows were rewritten to its
// id when it was deleted), else "Meghívott, nincs fiókja" (an invite never
// accepted): Napló shows no address.
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const NO_ACCOUNT = "Meghívott, nincs fiókja";
function emailRefs(target: string): Ref[] {
  return EMAIL.test(target) ? [{ kind: "email", id: target.toLowerCase() }] : [];
}

function renderTarget(target: string, names: ReadonlyMap<string, string>): string {
  // An address no account has (an invite never accepted): not shown.
  if (EMAIL.test(target)) return names.get(`email:${target.toLowerCase()}`) ?? NO_ACCOUNT;
  return renderRefs(target, names);
}

// The account a "user:<id>" target names, unless it is deleted.
function liveUser(target: string, names: ReadonlyMap<string, string>): string | null {
  const m = /^user:(.+)$/.exec(target);
  const name = m ? names.get(target) : undefined;
  return m && name !== undefined && name !== DELETED_NAME ? m[1]! : null;
}

const playerA = alias(users, "player_a");
const playerB = alias(users, "player_b");
const person = (name: string | null, deletedAt: Date | null) => (deletedAt || name === null ? DELETED_NAME : name || "Névtelen");

// What each reference names, by "kind:id". Kinds nothing looks up (match,
// signup) render as "Meccs #5".
async function namesOf(refs: Ref[], leagueRows: { id: number; slug: string; name: string }[]): Promise<Map<string, string>> {
  const ids = (kind: string) => [...new Set(refs.filter((r) => r.kind === kind).map((r) => r.id))];
  const numbers = (kind: string) => ids(kind).map(Number).filter(Number.isInteger);
  const out = new Map<string, string>();
  for (const l of leagueRows) {
    out.set(`league:${l.id}`, l.name);
    out.set(`league:${l.slug}`, l.name);
  }
  const pairName = (r: { aName: string | null; aDel: Date | null; bName: string | null; bDel: Date | null }) =>
    `${person(r.aName, r.aDel)} – ${person(r.bName, r.bDel)}`;
  const pairCols = { aName: playerA.name, aDel: playerA.deletedAt, bName: playerB.name, bDel: playerB.deletedAt };
  const each = <T>(list: readonly T[], run: (part: T[]) => Promise<void>) => Promise.all(chunks(list).map(run));

  await Promise.all([
    each(ids("user"), async (part) => {
      for (const u of await db.select({ id: users.id, name: users.name, deletedAt: users.deletedAt }).from(users).where(inArray(users.id, part)))
        out.set(`user:${u.id}`, person(u.name, u.deletedAt));
    }),
    each(ids("email"), async (part) => {
      for (const u of await db
        .select({ email: users.email, name: users.name, deletedAt: users.deletedAt })
        .from(users)
        .where(inArray(sql`lower(${users.email})`, part)))
        out.set(`email:${u.email.toLowerCase()}`, person(u.name, u.deletedAt));
    }),
    each(numbers("pair"), async (part) => {
      for (const p of await db
        .select({ id: pairs.id, ...pairCols })
        .from(pairs)
        .innerJoin(playerA, eq(playerA.id, pairs.playerA))
        .innerJoin(playerB, eq(playerB.id, pairs.playerB))
        .where(inArray(pairs.id, part)))
        out.set(`pair:${p.id}`, pairName(p));
    }),
    each(numbers("season_entry"), async (part) => {
      for (const e of await db
        .select({ id: seasonEntries.id, season: seasons.name, ...pairCols })
        .from(seasonEntries)
        .innerJoin(seasons, eq(seasons.id, seasonEntries.seasonId))
        .innerJoin(pairs, eq(pairs.id, seasonEntries.pairId))
        .innerJoin(playerA, eq(playerA.id, pairs.playerA))
        .innerJoin(playerB, eq(playerB.id, pairs.playerB))
        .where(inArray(seasonEntries.id, part)))
        out.set(`season_entry:${e.id}`, `${pairName(e)} (${e.season})`);
    }),
    each(numbers("season"), async (part) => {
      for (const s of await db.select({ id: seasons.id, name: seasons.name }).from(seasons).where(inArray(seasons.id, part)))
        out.set(`season:${s.id}`, s.name);
    }),
    each(numbers("club"), async (part) => {
      for (const c of await db.select({ id: clubs.id, name: clubs.name }).from(clubs).where(inArray(clubs.id, part))) out.set(`club:${c.id}`, c.name);
    }),
    each(ids("city"), async (part) => {
      for (const c of await db.select({ slug: cities.slug, name: cities.name }).from(cities).where(inArray(cities.slug, part)))
        out.set(`city:${c.slug}`, c.name);
    }),
    each(numbers("broadcast"), async (part) => {
      for (const b of await db.select({ id: broadcasts.id, subject: broadcasts.subject }).from(broadcasts).where(inArray(broadcasts.id, part)))
        out.set(`broadcast:${b.id}`, `„${b.subject}”`);
    }),
  ]);
  return out;
}

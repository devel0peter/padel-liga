// pairs.server.ts against a real SQLite (node:sqlite, in memory) with every
// migration in app/drizzle applied: the one-pair-per-league rule lives in the
// accept batch's SQL, so it is tested on a database, not on mocks. Email and
// the city list are stubbed; nothing leaves the process.
import { drizzle } from "drizzle-orm/sqlite-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Node built-ins: this file runs in Vitest (Node) but is type-checked with the
// Workers types, which have no node:fs or node:sqlite.
const { readdirSync, readFileSync } = await import(/* @vite-ignore */ `node:${"fs"}`);
const { DatabaseSync } = await import(/* @vite-ignore */ `node:${"sqlite"}`);

const MIGRATIONS = new URL("../../drizzle/", import.meta.url);

const h = vi.hoisted(() => ({ raw: null as any, db: null as any, mails: [] as any[] }));

vi.mock("~/db/client.server", async () => {
  const schema = await import("~/db/schema");
  const exec = (sql: string, params: any[], method: string) => {
    const st = h.raw.prepare(sql);
    if (method === "run") {
      st.run(...params);
      return { rows: [] };
    }
    st.setReturnArrays(true);
    if (method === "get") return { rows: st.get(...params) ?? undefined };
    return { rows: st.all(...params) };
  };
  h.db = drizzle(
    async (sql, params, method) => exec(sql, params, method),
    async (queries) => {
      h.raw.exec("BEGIN");
      try {
        const out = queries.map((q) => exec(q.sql, q.params, q.method));
        h.raw.exec("COMMIT");
        return out;
      } catch (e) {
        h.raw.exec("ROLLBACK");
        throw e;
      }
    },
    { schema },
  );
  return { get db() { return h.db; } };
});
vi.mock("~/lib/cities.server", () => ({ listedCities: async () => [{ slug: "gyor" }] }));
vi.mock("~/lib/email/outbox.server", () => ({
  queuePairInvite: async (to: string, input: any) => h.mails.push({ kind: "invite", to, ...input }),
  queuePairAnswer: async (to: string, input: any) => h.mails.push({ kind: "answer", ...input, toEmail: to }),
}));

const P = await import("~/lib/pairs.server");

function freshDb() {
  h.raw = new DatabaseSync(":memory:");
  h.raw.exec("PRAGMA foreign_keys = ON");
  const files = (readdirSync(MIGRATIONS) as string[]).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files)
    for (const stmt of readFileSync(new URL(f, MIGRATIONS), "utf8").split("--> statement-breakpoint"))
      if (stmt.trim()) h.raw.exec(stmt);
  h.raw.exec(`insert or replace into cities (slug, name, listed) values ('gyor', 'Győr', 1), ('deb', 'Debrecen', 0)`);
  h.raw.exec(`insert or replace into leagues (id, city, slug, name) values (1, 'gyor', 'gyor', 'Padelpárbaj Győr'), (2, 'deb', 'deb', 'Padelpárbaj Debrecen')`);
  for (const [id, name] of [["a", "Anna"], ["b", "Béla"], ["c", "Cecil"], ["d", "Dóra"]])
    h.raw.exec(`insert into users (id, email, name, consent_at) values ('${id}', '${id}@x.hu', '${name}', 1)`);
  h.mails = [];
}

const user = (id: string) => ({ id, email: `${id}@x.hu`, name: id.toUpperCase() }) as any;
const league = { id: 1, name: "Padelpárbaj Győr" };
const one = (sql: string) => h.raw.prepare(sql).get();
const all = (sql: string) => h.raw.prepare(sql).all();

function lastToken(): string {
  const link: string = h.mails.filter((m) => m.kind === "invite").at(-1).link;
  const url = new URL(link);
  const path = url.pathname === "/login" ? url.searchParams.get("returnTo")! : url.pathname;
  return path.split("/").at(-1)!;
}

describe("pairs.server on real SQLite", () => {
  beforeEach(freshDb);

  it("lists only leagues in listed cities", async () => {
    expect(await P.pairLeagues()).toEqual([league]);
  });

  it("A invites B, B accepts by token, both see the pair, A is emailed", async () => {
    expect(await P.createInvite(user("a"), league, " B@x.hu ")).toEqual({ ok: true });
    expect(h.mails[0]).toMatchObject({ kind: "invite", to: "b@x.hu", hasAccount: true, inviterName: "A" });
    expect(h.mails[0].link).toMatch(/^https:\/\/padelparbaj\.hu\/pair\/invite\/[A-Za-z0-9_-]{43}$/);
    const inv = await P.inviteByToken(lastToken());
    expect(inv).toMatchObject({ inviterName: "Anna", inviteeEmail: "b@x.hu", status: "pending", league: "Padelpárbaj Győr" });
    // Only the hash is stored.
    expect(one("select token_hash from pair_invites").token_hash).not.toBe(lastToken());
    expect(await P.answerInvite(user("b"), inv!.id, "accept")).toEqual({ ok: true });
    expect(h.mails[1]).toMatchObject({ kind: "answer", toEmail: "a@x.hu", accepted: true, inviteeName: "B" });
    const [oa] = await P.pairOverview(user("a"), [league]);
    const [ob] = await P.pairOverview(user("b"), [league]);
    expect(oa.pair).toMatchObject({ partnerName: "Béla", canDissolve: true });
    expect(ob.pair).toMatchObject({ partnerName: "Anna", canDissolve: true });
    expect(oa.sent).toBeNull();
  });

  it("shows sent and received invites", async () => {
    await P.createInvite(user("a"), league, "b@x.hu");
    const [oa] = await P.pairOverview(user("a"), [league]);
    const [ob] = await P.pairOverview(user("b"), [league]);
    expect(oa.sent).toMatchObject({ email: "b@x.hu" });
    expect(ob.received).toHaveLength(1);
    expect(ob.received[0].inviterName).toBe("Anna");
    expect(ob.sent).toBeNull();
  });

  it("refuses an invite to someone already in an active pair in the league", async () => {
    await P.createInvite(user("a"), league, "b@x.hu");
    await P.answerInvite(user("b"), 1, "accept");
    expect(await P.createInvite(user("c"), league, "b@x.hu")).toMatchObject({ ok: false, error: expect.stringContaining("már van párja") });
    expect(await P.createInvite(user("a"), league, "c@x.hu")).toMatchObject({ ok: false, error: expect.stringContaining("már van párod") });
  });

  it("refuses self-invite and a second pending invite", async () => {
    expect(await P.createInvite(user("a"), league, "A@x.hu")).toMatchObject({ ok: false });
    await P.createInvite(user("a"), league, "b@x.hu");
    expect(await P.createInvite(user("a"), league, "c@x.hu")).toMatchObject({ ok: false, error: expect.stringContaining("Már elküldtél") });
    expect(all("select * from pair_invites")).toHaveLength(1);
  });

  it("a declined invite tells the inviter", async () => {
    await P.createInvite(user("a"), league, "b@x.hu");
    expect(await P.answerInvite(user("b"), 1, "decline")).toEqual({ ok: true });
    expect(h.mails[1]).toMatchObject({ kind: "answer", toEmail: "a@x.hu", accepted: false });
    expect(one("select status from pair_invites").status).toBe("declined");
    expect(await P.answerInvite(user("b"), 1, "accept")).toMatchObject({ ok: false });
    expect(all("select * from pairs")).toHaveLength(0);
  });

  it("only the invitee can answer", async () => {
    await P.createInvite(user("a"), league, "b@x.hu");
    expect(await P.answerInvite(user("c"), 1, "accept")).toMatchObject({ ok: false, error: expect.stringContaining("nem ehhez a fiókhoz") });
    expect(all("select * from pairs")).toHaveLength(0);
  });

  it("an invitee without an account gets the login link and an account invite", async () => {
    await P.createInvite(user("a"), league, "new@x.hu");
    const url = new URL(h.mails[0].link);
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("email")).toBe("new@x.hu");
    expect(url.searchParams.get("returnTo")).toMatch(/^\/pair\/invite\//);
    expect(one("select note from account_invites where email = 'new@x.hu'").note).toBe("Pármeghívó");
  });

  it("accepting cancels both players' other pending invites in the league", async () => {
    await P.createInvite(user("a"), league, "b@x.hu"); // 1: a -> b
    await P.createInvite(user("c"), league, "b@x.hu"); // 2: c -> b
    await P.createInvite(user("b"), league, "d@x.hu"); // 3: b -> d
    await P.createInvite(user("d"), league, "a@x.hu"); // 4: d -> a
    expect(await P.answerInvite(user("b"), 1, "accept")).toEqual({ ok: true });
    expect(all("select id, status from pair_invites order by id").map((r: any) => r.status)).toEqual([
      "accepted",
      "cancelled",
      "cancelled",
      "cancelled",
    ]);
  });

  it("a player who accepted elsewhere can't accept a second one", async () => {
    await P.createInvite(user("a"), league, "b@x.hu"); // 1
    await P.createInvite(user("c"), league, "d@x.hu"); // 2
    await P.answerInvite(user("b"), 1, "accept");
    // A pending invite that slipped past the checks (a race): d -> a
    h.raw.exec(`insert into pair_invites (league_id, inviter_id, invitee_email, token_hash) values (1, 'd', 'a@x.hu', 'h')`);
    const id = one("select max(id) id from pair_invites").id;
    expect(await P.answerInvite(user("a"), id, "accept")).toMatchObject({ ok: false, error: expect.stringContaining("már van párod") });
    expect(all("select * from pairs where status = 'active'")).toHaveLength(1);
  });

  it("the batch itself refuses a second pair even when the pre-checks pass", async () => {
    await P.createInvite(user("a"), league, "b@x.hu"); // 1
    await P.answerInvite(user("b"), 1, "accept");
    h.raw.exec(`insert into pair_invites (league_id, inviter_id, invitee_email, token_hash) values (1, 'c', 'a@x.hu', 'h')`);
    const id = one("select max(id) id from pair_invites").id;
    const spy = vi.spyOn(await import("~/lib/pairs"), "checkAnswer").mockReturnValue(null);
    const result = await P.answerInvite(user("a"), id, "accept");
    spy.mockRestore();
    expect(result.ok).toBe(false);
    expect(all("select * from pairs where status = 'active'")).toHaveLength(1);
    expect(one(`select status from pair_invites where id = ${id}`).status).toBe("pending");
  });

  it("cancel: only the inviter, only pending", async () => {
    await P.createInvite(user("a"), league, "b@x.hu");
    expect(await P.cancelInvite(user("b"), 1)).toMatchObject({ ok: false });
    expect(await P.cancelInvite(user("a"), 1)).toEqual({ ok: true });
    expect(one("select status from pair_invites").status).toBe("cancelled");
    expect(await P.answerInvite(user("b"), 1, "accept")).toMatchObject({ ok: false });
    // and a new invite is allowed again
    expect(await P.createInvite(user("a"), league, "c@x.hu")).toEqual({ ok: true });
  });

  it("dissolve: either player, then both are free; a dissolved pair's invite can't re-form it", async () => {
    await P.createInvite(user("a"), league, "b@x.hu");
    await P.answerInvite(user("b"), 1, "accept");
    const pairId = one("select id from pairs").id;
    expect(await P.dissolvePair(user("c"), pairId)).toMatchObject({ ok: false });
    expect(await P.dissolvePair(user("b"), pairId)).toEqual({ ok: true });
    expect(one("select status, dissolved_by from pairs")).toMatchObject({ status: "dissolved", dissolved_by: "b" });
    expect(await P.dissolvePair(user("a"), pairId)).toMatchObject({ ok: false });
    expect(await P.answerInvite(user("b"), 1, "accept")).toMatchObject({ ok: false });
    expect(await P.createInvite(user("a"), league, "c@x.hu")).toEqual({ ok: true });
    const [oa] = await P.pairOverview(user("a"), [league]);
    expect(oa.pair).toBeNull();
  });

  it("caps invites per day", async () => {
    for (const e of ["c", "d", "e", "f", "g"]) {
      expect(await P.createInvite(user("a"), league, `${e}@x.hu`)).toEqual({ ok: true });
      await P.cancelInvite(user("a"), one("select max(id) id from pair_invites").id);
    }
    expect(await P.createInvite(user("a"), league, "h@x.hu")).toMatchObject({ ok: false, error: expect.stringContaining("legfeljebb 5") });
  });

  it("a double accept (two tabs) forms one pair and emails the inviter once", async () => {
    await P.createInvite(user("a"), league, "b@x.hu");
    expect(await P.answerInvite(user("b"), 1, "accept")).toEqual({ ok: true });
    expect(await P.answerInvite(user("b"), 1, "accept")).toEqual({ ok: true });
    expect(all("select * from pairs")).toHaveLength(1);
    expect(h.mails.filter((m) => m.kind === "answer")).toHaveLength(1);
  });

  it("mutual invites: accepting one cancels the other", async () => {
    await P.createInvite(user("a"), league, "b@x.hu"); // 1
    await P.createInvite(user("b"), league, "a@x.hu"); // 2
    expect(await P.answerInvite(user("a"), 2, "accept")).toEqual({ ok: true });
    expect(all("select status from pair_invites order by id").map((r: any) => r.status)).toEqual(["cancelled", "accepted"]);
    expect(await P.answerInvite(user("b"), 1, "accept")).toMatchObject({ ok: false });
    expect(all("select * from pairs")).toHaveLength(1);
  });

  it("two invitees of the same inviter: the second accept is refused", async () => {
    await P.createInvite(user("a"), league, "b@x.hu"); // 1
    // A second pending invite from a, as a race past the one-pending rule
    // could leave it (the unique index allows it once the first is answered).
    h.raw.exec("update pair_invites set status = 'declined' where id = 1");
    await P.createInvite(user("a"), league, "c@x.hu"); // 2
    h.raw.exec("drop index pair_invites_pending_idx");
    h.raw.exec("update pair_invites set status = 'pending' where id = 1");
    expect(await P.answerInvite(user("c"), 2, "accept")).toEqual({ ok: true });
    expect(await P.answerInvite(user("b"), 1, "accept")).toMatchObject({ ok: false });
    expect(all("select * from pairs where status = 'active'")).toHaveLength(1);
  });

  it("pairs in another league don't count", async () => {
    h.raw.exec("insert into pairs (league_id, player_a, player_b) values (2, 'a', 'b')");
    expect(await P.createInvite(user("a"), league, "b@x.hu")).toEqual({ ok: true });
    expect(await P.answerInvite(user("b"), 1, "accept")).toEqual({ ok: true });
  });

  it("cancel after the invitee accepted is refused", async () => {
    await P.createInvite(user("a"), league, "b@x.hu");
    await P.answerInvite(user("b"), 1, "accept");
    expect(await P.cancelInvite(user("a"), 1)).toMatchObject({ ok: false, error: expect.stringContaining("visszavonni") });
    expect(one("select status from pair_invites").status).toBe("accepted");
  });
});

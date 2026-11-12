// Push topics (#349, D159): every player kind in exactly one topic, and the
// one rule every push path applies (pushWanted).
import { describe, expect, it, vi } from "vitest";

const flags = vi.hoisted(() => ({ substitutes: false }));
vi.mock("~/lib/substitutes", async (original) => ({
  ...(await original<typeof import("~/lib/substitutes")>()),
  substitutesEnabled: () => flags.substitutes,
}));

const { notifications } = await import("~/db/schema");
const {
  channelKey,
  KIND_TOPIC,
  NOTIFICATION_KINDS,
  PUSH_TOPICS,
  isPushTopic,
  pushTopic,
  pushWanted,
  topicEnabled,
  topicKey,
  topicOf,
} = await import("~/lib/notifications");

// Stored kinds that are not a player's: the organizers' own switches, the
// profile's "Próba", and the interest list's old kind (D129, no longer made).
const NOT_PLAYER_KINDS = new Set([...Object.keys(NOTIFICATION_KINDS), "test", "new_signup"]);
const TOPICS = Object.keys(PUSH_TOPICS) as (keyof typeof PUSH_TOPICS)[];

describe("push topics (#349)", () => {
  it("every player kind the database can store has exactly one topic", () => {
    const playerKinds = notifications.kind.enumValues.filter((k) => !NOT_PLAYER_KINDS.has(k));
    expect(playerKinds.length).toBeGreaterThan(20);
    const unmapped = playerKinds.filter((k) => !Object.hasOwn(KIND_TOPIC, k));
    expect(unmapped).toEqual([]);
    for (const k of playerKinds) expect(TOPICS).toContain(KIND_TOPIC[k as keyof typeof KIND_TOPIC]);
    // No stray entry: a mapped kind is one the database can store.
    for (const k of Object.keys(KIND_TOPIC)) expect(playerKinds).toContain(k);
  });

  it("the organizers' kinds and Próba have no topic", () => {
    for (const k of [...Object.keys(NOTIFICATION_KINDS), "test"] as const) expect(topicOf(k as never)).toBeNull();
  });

  it("the five topics of the issue, each with a name and a sentence", () => {
    expect(TOPICS.map((t) => PUSH_TOPICS[t].label)).toEqual([
      "Időpont-egyeztetés",
      "Emlékeztetők",
      "Eredmények",
      "Csoport és szezon",
      "Helyettesek és mulasztások",
    ]);
    for (const t of TOPICS) expect(PUSH_TOPICS[t].description).toMatch(/\.$/);
    expect(KIND_TOPIC.match_tomorrow).toBe("reminders");
    expect(KIND_TOPIC.match_proposal).toBe("scheduling");
    expect(KIND_TOPIC.strike).toBe("absences");
  });

  it("a new player has every topic on", () => {
    for (const t of TOPICS) expect(topicEnabled(new Set(), t)).toBe(true);
  });

  it("a topic off stops only its own kinds' push", () => {
    const off = new Set([topicKey("reminders")]);
    expect(pushWanted(off, "match_tomorrow")).toBe(false);
    expect(pushWanted(off, "match_no_proposal")).toBe(false);
    expect(pushWanted(off, "match_proposal")).toBe(true);
    // The organizers' kinds follow their own switches, not the topics.
    expect(pushWanted(new Set(TOPICS.map(topicKey)), "result_disputed")).toBe(true);
    expect(pushWanted(new Set(TOPICS.map(topicKey)), "test")).toBe(true);
  });

  it("push off stops every push, whatever the topics say", () => {
    const off = new Set([channelKey("push")]);
    for (const k of [...Object.keys(KIND_TOPIC), "result_disputed", "test"]) expect(pushWanted(off, k as never)).toBe(false);
  });

  it("the profile's topic names are checked", () => {
    expect(isPushTopic("reminders")).toBe(true);
    expect(isPushTopic("channel:push")).toBe(false);
    expect(isPushTopic("toString")).toBe(false);
  });

  it("without substitutes (D145) the last topic is only about no-shows and strikes", () => {
    flags.substitutes = false;
    expect(pushTopic("absences").label).toBe("Mulasztások");
    expect(pushTopic("absences").description).not.toMatch(/helyettes/i);
    flags.substitutes = true;
    expect(pushTopic("absences")).toEqual(PUSH_TOPICS.absences);
    expect(pushTopic("reminders")).toEqual(PUSH_TOPICS.reminders);
  });
});

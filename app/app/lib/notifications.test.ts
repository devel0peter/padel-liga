import { describe, expect, it } from "vitest";

import {
  channelEnabled,
  substituteAnnouncedMessage,
  substituteDecidedMessage,
  substituteRequestedMessage,
  substituteRevokedMessage,
  noShowDecidedMessage,
  noShowReportedMessage,
  channelKey,
  followsEmailSwitch,
  groupsPublishedMessage,
  matchAgreedTimeMessage,
  matchDecidedMessage,
  matchCancelledMessage,
  matchDeclinedMessage,
  matchProposalMessage,
  matchResultConfirmedMessage,
  matchResultDisputedMessage,
  matchResultMessage,
  disputeRecipients,
  resultDisputedMessage,
  matchScheduledMessage,
  DIGEST_KINDS,
  isChannel,
  isEnabled,
  isNotificationKind,
  kindsFor,
  pairIntroMessage,
  pairWithdrawnMessage,
  seasonEntryMessage,
  newSignupMessage,
  parseSubscription,
  pushPayload,
  safeTarget,
  signupRecipients,
  timeAgo,
  type SignupSummary,
} from "./notifications";

const gyor = { id: 1, slug: "gyor", city: "gyor", name: "Padelpárbaj Győr" };

describe("kindsFor", () => {
  it("offers new signups, disputed results and substitute requests to Szervezők and Admins only", () => {
    expect(kindsFor({ platformRole: "player", leagues: [] })).toEqual([]);
    expect(kindsFor({ platformRole: "player", leagues: [gyor] })).toEqual(["new_signup", "result_disputed", "substitute_requested", "no_show_reported"]);
    expect(kindsFor({ platformRole: "superadmin", leagues: [] })).toEqual(["new_signup", "result_disputed", "substitute_requested", "no_show_reported"]);
  });
});

describe("isEnabled", () => {
  it("is on until switched off; the test kind is always on", () => {
    expect(isEnabled(new Set(), "new_signup")).toBe(true);
    expect(isEnabled(new Set(["new_signup"]), "new_signup")).toBe(false);
    expect(isEnabled(new Set(["test"]), "test")).toBe(true);
  });
});

describe("signupRecipients", () => {
  const organizers = [
    { userId: "anna", city: "gyor", leagueSlug: "gyor" },
    { userId: "bela", city: "pecs", leagueSlug: "pecs" },
    { userId: "peter", city: "gyor", leagueSlug: "gyor" },
  ];

  it("sends to the city's Szervezők and every Admin, once each", () => {
    expect(signupRecipients("gyor", organizers, ["peter"])).toEqual([
      { userId: "peter", admin: true, leagueSlug: null },
      { userId: "anna", admin: false, leagueSlug: "gyor" },
    ]);
  });

  it("sends a city without a league to the Admins only", () => {
    expect(signupRecipients("other", organizers, ["peter"])).toEqual([{ userId: "peter", admin: true, leagueSlug: null }]);
    expect(signupRecipients("other", organizers, [])).toEqual([]);
  });
});

describe("newSignupMessage", () => {
  const pair: SignupSummary = { mode: "pair", level: "halado", cityName: "Győr", pairs: 9, solos: 4 };
  const organizer = { userId: "anna", admin: false, leagueSlug: "gyor" };
  const admin = { userId: "peter", admin: true, leagueSlug: null };

  it("names the city, the level and the counts, never the people", () => {
    expect(newSignupMessage(pair, organizer)).toEqual({
      title: "Új jelentkező · Győr",
      body: "Új pár jelentkezett, haladó szint. Eddig 9 pár és 4 egyéni jelentkező.",
      url: "/admin/leagues/gyor",
    });
  });

  it("says when the signer would organize a league", () => {
    expect(newSignupMessage({ ...pair, organize: true }, admin).body).toBe(
      "Új pár jelentkezett, haladó szint. Szívesen szervezne ligát. Eddig 9 pár és 4 egyéni jelentkező.",
    );
  });

  it("sends a Szervező to the solo list for a solo signup", () => {
    const m = newSignupMessage({ ...pair, mode: "solo", level: "kezdo" }, organizer);
    expect(m.body).toBe("Új egyéni jelentkező (párt keres), kezdő szint. Eddig 9 pár és 4 egyéni jelentkező.");
    expect(m.url).toBe("/admin/leagues/gyor/solos");
  });

  it("sends an Admin to the signup list", () => {
    expect(newSignupMessage(pair, admin).url).toBe("/admin/signups");
  });
});

describe("pushPayload", () => {
  it("opens the notification through its read-marking link", () => {
    expect(pushPayload(42, { title: "T", body: "B", url: "/admin/signups" })).toEqual({
      title: "T",
      body: "B",
      url: "/notifications/42",
      tag: "n42",
    });
  });
});

describe("safeTarget", () => {
  it("keeps paths on this site and drops anything else", () => {
    expect(safeTarget("/admin/signups")).toBe("/admin/signups");
    expect(safeTarget("//evil.example")).toBe("/notifications");
    expect(safeTarget("https://evil.example")).toBe("/notifications");
  });
});

describe("timeAgo", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const ago = (ms: number) => timeAgo(new Date(now.getTime() - ms), now, () => "okt. 1.");
  const min = 60_000;

  it("counts minutes, hours and days, then shows the date", () => {
    expect(ago(30_000)).toBe("most");
    expect(ago(5 * min)).toBe("5 perce");
    expect(ago(3 * 60 * min)).toBe("3 órája");
    expect(ago(25 * 60 * min)).toBe("tegnap");
    expect(ago(4 * 24 * 60 * min)).toBe("4 napja");
    expect(ago(8 * 24 * 60 * min)).toBe("okt. 1.");
  });
});

describe("parseSubscription", () => {
  const p256dh = "B".padEnd(87, "a");
  const auth = "c".repeat(22);
  const form = (endpoint: string, extra: Record<string, string> = {}) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ endpoint, p256dh, auth, ...extra })) f.set(k, v);
    return f;
  };

  it("accepts the browsers' push services", () => {
    for (const endpoint of [
      "https://fcm.googleapis.com/fcm/send/abc",
      "https://updates.push.services.mozilla.com/wpush/v2/abc",
      "https://web.push.apple.com/QAbc",
    ])
      expect(parseSubscription(form(endpoint))).toEqual({ endpoint, p256dh, auth });
  });

  it("refuses any other address, so the server can't be made to call it", () => {
    for (const endpoint of [
      "http://fcm.googleapis.com/fcm/send/abc",
      "https://fcm.googleapis.com:8443/x",
      "https://evilpush.apple.com.example/x",
      "https://localhost/x",
      "nem url",
    ])
      expect(parseSubscription(form(endpoint))).toBeNull();
  });

  it("refuses malformed keys", () => {
    expect(parseSubscription(form("https://fcm.googleapis.com/x", { p256dh: "short" }))).toBeNull();
    expect(parseSubscription(form("https://fcm.googleapis.com/x", { auth: "c".repeat(21) + "=" }))).toBeNull();
  });
});

describe("channels (#115)", () => {
  it("email and push are on until switched off", () => {
    expect(channelEnabled(new Set(), "email")).toBe(true);
    expect(channelEnabled(new Set(), "push")).toBe(true);
    expect(channelEnabled(new Set(["channel:email"]), "email")).toBe(false);
    expect(channelEnabled(new Set(["channel:email"]), "push")).toBe(true);
    // A kind switched off is not a channel switched off.
    expect(channelEnabled(new Set(["new_signup"]), "push")).toBe(true);
  });

  it("knows only email and push, and their rows are never a kind", () => {
    expect(isChannel("email")).toBe(true);
    expect(isChannel("push")).toBe(true);
    expect(isChannel("sms")).toBe(false);
    expect(isChannel("toString")).toBe(false);
    expect(isNotificationKind(channelKey("email"))).toBe(false);
    expect(isEnabled(new Set([channelKey("email"), channelKey("push")]), "new_signup")).toBe(true);
  });

  it("only login codes and signup confirmations ignore the switch (Peter, 2026-10-29)", () => {
    expect(followsEmailSwitch("login_code")).toBe(false);
    expect(followsEmailSwitch("signup_confirmation")).toBe(false);
    for (const kind of [
      "partner_notice",
      "pair_intro",
      "registration_invite",
      "broadcast",
      "season_entry_decision",
      "groups_published",
    ] as const)
      expect(followsEmailSwitch(kind)).toBe(true);
  });
});

describe("pairIntroMessage", () => {
  it("says a partner was found, with no names", () => {
    expect(pairIntroMessage("Győr")).toEqual({
      title: "Párt találtunk neked",
      body: "A szervező párba tett egy másik egyéni jelentkezővel (Győr). A Párom oldalon látod, ki az.",
      url: "/pair",
    });
  });
});

describe("player messages (#115)", () => {
  const base = { league: "Padelpárbaj Győr", season: "2026/27 tél" };

  it("#153: entered says where the pair starts; no names, no approval", () => {
    expect(seasonEntryMessage({ ...base, joins: { phase: 1, startsAt: new Date("2026-11-08T23:00:00Z") } })).toEqual({
      title: "Beneveztetek",
      body: "2026/27 tél, Padelpárbaj Győr. Az 1. körtől játszotok (kezdés: nov. 9.).",
      url: "/pair",
    });
    expect(seasonEntryMessage({ ...base, joins: { phase: 2, startsAt: new Date("2026-11-29T23:00:00Z") } }).body).toBe(
      "2026/27 tél, Padelpárbaj Győr. A 2. körtől játszotok (kezdés: nov. 30.).",
    );
    expect(seasonEntryMessage({ ...base, joins: null }).body).toBe("2026/27 tél, Padelpárbaj Győr. A következő szezontól játszotok.");
  });

  it("the groups: group, phase and deadline in Budapest time", () => {
    expect(groupsPublishedMessage({ ...base, phase: 1, group: 3, deadline: new Date("2026-11-29T22:59:00Z") })).toEqual({
      title: "Itt a csoportod: 3. csoport",
      body: "1. kör, 2026/27 tél, Padelpárbaj Győr. Határidő: nov. 29., vasárnap 23:59.",
      url: "/home",
    });
  });
});

describe("match scheduling notifications (#26, spec 13)", () => {
  const slot = new Date("2026-11-17T17:00:00Z");

  it("a proposal or counter-proposal links to the match, without names", () => {
    expect(matchProposalMessage({ matchId: 7, week: 2, counter: false, slots: 3 })).toEqual({
      title: "Időpontokat ajánlottak",
      body: "Az ellenfeletek 3 időpontot ajánlott a 2. heti meccsetekre. Válassz egyet, vagy ajánlj másikat.",
      url: "/matches/7",
    });
    expect(matchProposalMessage({ matchId: 7, week: 2, counter: true, slots: 4 }).title).toBe("Új időpontokat ajánlottak");
  });

  it("an agreed time waiting for confirmation", () => {
    expect(matchAgreedTimeMessage({ matchId: 7, slot })).toEqual({
      title: "Erősítsd meg az időpontot",
      body: "Az ellenfeletek rögzítette a megbeszélt időpontot: nov. 17., kedd 18:00. Erősítsd meg, vagy jelezd, ha nem így beszéltétek.",
      url: "/matches/7",
    });
  });

  it("scheduled: accepted or confirmed", () => {
    expect(matchScheduledMessage({ matchId: 7, slot, confirmed: false }).body).toBe("Az ellenfeletek elfogadta az időpontot: nov. 17., kedd 18:00.");
    expect(matchScheduledMessage({ matchId: 7, slot, confirmed: true }).body).toBe(
      "Az ellenfeletek megerősítette a megbeszélt időpontot: nov. 17., kedd 18:00.",
    );
  });

  it("declined", () => {
    expect(matchDeclinedMessage({ matchId: 7, slot })).toEqual({
      title: "Nem erősítették meg az időpontot",
      body: "Az ellenfeletek szerint nem nov. 17., kedd 18:00 a meccs. Egyeztessetek újra.",
      url: "/matches/7",
    });
  });

  it("a cancellation (#27): late says the cancelling pair proposes next; no names", () => {
    expect(matchCancelledMessage({ matchId: 7, slot, late: false })).toEqual({
      title: "Lemondták a meccset",
      body: "Az ellenfeletek lemondta a nov. 17., kedd 18:00 időpontot. Egyeztessetek újra.",
      url: "/matches/7",
    });
    expect(matchCancelledMessage({ matchId: 7, slot, late: true }).body).toBe(
      "Az ellenfeletek 24 órán belül lemondta a nov. 17., kedd 18:00 időpontot. Nekik kell új időpontokat ajánlaniuk.",
    );
  });

  it("the digest kinds: scheduled, declined, cancelled, the reminders, confirmed and decided results; never an instant one (#31)", () => {
    expect([...DIGEST_KINDS]).toEqual(["match_scheduled", "match_declined", "match_cancelled", "match_no_proposal", "match_week_end", "match_deadline_soon", "match_result_confirmed", "match_decided"]);
    for (const instant of ["match_proposal", "match_agreed_time", "match_tomorrow", "match_result"] as const) expect(DIGEST_KINDS).not.toContain(instant);
  });
});

describe("result messages (#28, #29, spec 13)", () => {
  it("waiting for confirmation: the score from the recipient's side and the 48 hours", () => {
    expect(matchResultMessage({ matchId: 7, score: "1:4, 2:4" })).toEqual({
      title: "Erősítsd meg az eredményt",
      body: "Az ellenfeletek rögzítette az eredményt: 1:4, 2:4. Erősítsd meg, vagy jelezd, ha nem így volt. 48 óra múlva magától elfogadjuk.",
      url: "/matches/7",
    });
  });

  it("confirmed or accepted after 48 hours", () => {
    expect(matchResultConfirmedMessage({ matchId: 7, score: "4:1, 4:2", auto: false }).body).toBe("Megerősítették az eredményt: 4:1, 4:2.");
    expect(matchResultConfirmedMessage({ matchId: 7, score: "4:1, 4:2", auto: true })).toEqual({
      title: "Végleges az eredmény",
      body: "48 óra után magától elfogadtuk az eredményt: 4:1, 4:2.",
      url: "/matches/7",
    });
  });

  it("a dispute: the recording pair is told at once, no names and no score (#178)", () => {
    expect(matchResultDisputedMessage({ matchId: 7 })).toEqual({
      title: "Vitatják az eredményt",
      body: "Az ellenfeletek nem ért egyet a rögzített eredménnyel. A szervező dönt, szólunk, ha megvan.",
      url: "/matches/7",
    });
    // Not a digest item: it goes out at once (D83).
    expect(DIGEST_KINDS).not.toContain("match_result_disputed");
  });

  it("a dispute: the organizers and Admins get the decision page link, once each (#178)", () => {
    expect(disputeRecipients(["o", "adm", "o2"], ["adm", "adm2"], "p1")).toEqual(["adm", "adm2", "o", "o2"]);
    expect(disputeRecipients([], [], "p1")).toEqual([]);
    expect(resultDisputedMessage({ matchId: 7, leagueSlug: "gyor", leagueName: "Padelpárbaj Győr", week: 2 })).toEqual({
      title: "Vitatott eredmény · Padelpárbaj Győr",
      body: "A 2. heti meccsek egyikének eredményét vitatják. A döntés rád vár.",
      url: "/admin/leagues/gyor/matches/7/decide",
    });
  });

  it("a dispute: the organizer or Admin who disputed is left out, the others are not (#221)", () => {
    expect(disputeRecipients(["o", "p1"], ["adm"], "p1")).toEqual(["adm", "o"]);
    expect(disputeRecipients(["o"], ["p1", "adm"], "p1")).toEqual(["adm", "o"]);
  });

  it("an organizer's decision: the outcome, not the reason", () => {
    expect(matchDecidedMessage({ matchId: 7, outcome: "Játék nélküli győzelem nektek (4:0, 4:0)" })).toEqual({
      title: "A szervező döntött a meccsetekről",
      body: "Játék nélküli győzelem nektek (4:0, 4:0). Az indoklást a meccs oldalán látod.",
      url: "/matches/7",
    });
  });
});

describe("pairWithdrawnMessage (#34)", () => {
  const input = { league: "Padelpárbaj Győr", season: "2026/27 tél", phase: 1, group: 2, reason: "Sérülés." };

  it("tells the pair it is out of the round and the season, with the reason, and links to Párom", () => {
    const m = pairWithdrawnMessage(input, "pair");
    expect(m.title).toBe("A szervező visszaléptetett titeket a körből");
    expect(m.body).toContain("2. csoport, 1. kör, 2026/27 tél, Padelpárbaj Győr.");
    expect(m.body).toContain("a szezonból is kikerültetek");
    expect(m.body).toMatch(/Indok: Sérülés\.$/);
    expect(m.url).toBe("/pair");
  });

  it("tells the group's other pairs without the reason", () => {
    const m = pairWithdrawnMessage(input, "group");
    expect(m.title).toBe("Visszalépett egy pár a csoportodból");
    expect(m.body).not.toContain("Sérülés");
    expect(m.body).toContain("kikerültek a tabellából");
    expect(m.url).toBe("/home");
  });

  it("is not a digest item (no email, ever)", () => {
    expect(DIGEST_KINDS).not.toContain("pair_withdrawn");
  });
});

describe("substitute notices (#37, D109)", () => {
  const n = { matchId: 7, substitute: "Nagy Béla", absent: "Kiss Anna" };

  it("tells the organizers without names, linking to Helyettesek", () => {
    expect(substituteRequestedMessage({ leagueSlug: "gyor", leagueName: "Padelpárbaj Győr", week: 2 })).toEqual({
      title: "Helyettes kérés · Padelpárbaj Győr",
      body: "Egy pár helyettest kér a 2. heti meccsére. A jóváhagyás rád vár.",
      url: "/admin/leagues/gyor/substitutes",
    });
  });

  it("tells the asking pair the decision, never the reason", () => {
    expect(substituteDecidedMessage({ ...n, approved: true })).toMatchObject({ title: "Jóváhagyták a helyettest", url: "/matches/7" });
    expect(substituteDecidedMessage({ ...n, approved: false }).body).toBe("Nagy Béla nem játszhat Kiss Anna helyett. A részleteket a meccs oldalán látod.");
  });

  it("tells the opponents who plays, and when it's revoked", () => {
    expect(substituteAnnouncedMessage(n).body).toBe("Kiss Anna helyett Nagy Béla játszik a meccseteken.");
    expect(substituteRevokedMessage({ ...n, ours: false }).body).toBe("Kiss Anna helyett mégsem Nagy Béla játszik a meccseteken.");
    expect(substituteRevokedMessage({ ...n, ours: true }).body).toMatch(/^Nagy Béla mégsem játszhat Kiss Anna helyett/);
  });

  it("are not digest items (no email, D83)", () => {
    for (const kind of ["substitute_approved", "substitute_rejected", "substitute_revoked"] as const) expect(DIGEST_KINDS).not.toContain(kind);
  });
});

describe("no-show notices (#33, D108)", () => {
  it("tells the organizers without names, linking to the decision page", () => {
    expect(noShowReportedMessage({ matchId: 7, leagueSlug: "gyor", leagueName: "Padelpárbaj Győr", week: 2 })).toEqual({
      title: "Nem jöttek el · Padelpárbaj Győr",
      body: "Egy pár jelezte, hogy az ellenfele nem jött el a 2. heti meccsre. A döntés rád vár.",
      url: "/admin/leagues/gyor/matches/7/decide",
    });
  });

  it("tells each pair the decision from its own side, never the reason; not digest items", () => {
    const won = noShowDecidedMessage({ matchId: 7, confirmed: true, reported: true });
    const lost = noShowDecidedMessage({ matchId: 7, confirmed: true, reported: false });
    expect(won).toMatchObject({ title: "Jóváhagyta a szervező: nem jöttek el", url: "/matches/7" });
    expect(won.body).toContain("4-0 4-0");
    expect(lost.body).toContain("fekete pontot");
    expect(noShowDecidedMessage({ matchId: 7, confirmed: false, reported: true }).title).toBe("A szervező elutasította a bejelentésed");
    expect(noShowDecidedMessage({ matchId: 7, confirmed: false, reported: false }).title).toBe("A szervező elutasította az ellenfeleitek bejelentését");
    for (const kind of ["no_show_confirmed", "no_show_rejected"] as const) expect(DIGEST_KINDS).not.toContain(kind);
  });
});

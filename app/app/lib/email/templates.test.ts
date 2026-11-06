import { describe, expect, it } from "vitest";

import type { InterestSignup } from "../interest";
import {
  broadcastEmail,
  groupsPublished,
  escapeHtml,
  loginCode,
  dailyDigest,
  matchAgreedTime,
  matchTomorrow,
  matchProposal,
  matchResult,
  pairCreated,
  pairIntro,
  partnerNotice,
  registrationInvite,
  registrationLink,
  seasonEntered,
  signupConfirmation,
  textToHtml,
} from "./templates";

const GYOR = [{ slug: "gyor", name: "Győr" }];

const pair: InterestSignup = {
  city: "gyor",
  cityOther: null,
  mode: "pair",
  name1: "Nagy Anna",
  email1: "anna@example.com",
  name2: "Kovács Béla",
  email2: "bela@example.com",
  level: "kezdo",
  note: null,
  ref: null,
  homeClub: null,
  wantsToOrganize: false,
};

describe("textToHtml", () => {
  it("splits paragraphs, keeps line breaks and escapes HTML", () => {
    expect(textToHtml("Szia <b>!\nmásodik sor\n\nÚj bekezdés")).toBe(
      '<p style="margin:0 0 16px">Szia &lt;b&gt;!<br>második sor</p>\n<p style="margin:0 0 16px">Új bekezdés</p>',
    );
  });

  it("links URLs without the trailing punctuation", () => {
    expect(textToHtml("Nézd: https://padelparbaj.hu/rules.")).toContain(
      '<a href="https://padelparbaj.hu/rules" style="color:#1e5ba8">https://padelparbaj.hu/rules</a>.',
    );
  });

  it("does not turn an escaped javascript: text into a link", () => {
    expect(textToHtml('javascript:alert("x")')).not.toContain("<a");
  });
});

describe("signupConfirmation", () => {
  it("greets the signer and summarises the signup", () => {
    const e = signupConfirmation(pair, GYOR);
    expect(e.subject).toBe("Megkaptuk a jelentkezésed – Padelpárbaj");
    expect(e.text).toContain("Szia Nagy Anna!");
    expect(e.text).toContain("Párod: Kovács Béla");
    expect(e.text).toContain("Szint: Kezdő");
    expect(e.text).toContain("Város: Győr");
    expect(e.html).toContain("Szia Nagy Anna!");
    expect(e.text).not.toContain("Leiratkozás");
  });

  it("tells solo players we help find a partner", () => {
    const e = signupConfirmation({ ...pair, mode: "solo", name2: null, email2: null });
    expect(e.text).toContain("Egyedül jelentkeztél");
    expect(e.text).toContain("Segítünk párt találni");
  });

  it("says there is no league yet in another city", () => {
    const e = signupConfirmation({ ...pair, city: "other", cityOther: "Pécs" });
    expect(e.text).toContain("(Pécs), még nincs liga");
  });

  it("escapes names in the HTML", () => {
    expect(signupConfirmation({ ...pair, name1: "<script>" }).html).not.toContain("<script>");
  });

  it("never says the start waits for enough pairs (#83)", () => {
    const solo = { ...pair, mode: "solo", name2: null, email2: null } as const;
    const other = { ...pair, city: "other", cityOther: "Pécs" };
    for (const s of [pair, solo, other]) {
      const e = signupConfirmation(s, GYOR);
      expect(e.text).not.toMatch(/elég pár|összegyűl/);
      expect(e.html).not.toMatch(/elég pár|összegyűl/);
    }
    expect(signupConfirmation(pair, GYOR).text).toContain("Írunk az indulásról és a következő lépésekről.");
    expect(signupConfirmation(solo, GYOR).text).toContain("Segítünk párt találni, és írunk az indulásról.");
    expect(signupConfirmation(other, GYOR).text).toContain("Ha lesz szervező, szólunk.");
    expect(signupConfirmation(other, GYOR).text).not.toContain("párt keresel");
    expect(signupConfirmation({ ...other, wantsToOrganize: true }, GYOR).text).toContain(
      "Azt írtad, szívesen szerveznél: hamarosan írunk.",
    );
  });
});

describe("partnerNotice", () => {
  it("names who signed them up and how to ask for deletion", () => {
    const e = partnerNotice(pair, GYOR);
    expect(e.subject).toBe("Nagy Anna jelentkeztetett titeket a Padelpárbajra");
    expect(e.text).toContain("Szia Kovács Béla!");
    expect(e.text).toContain("töröljük az adataidat");
    // What else they get, as the privacy page says: the registration invite only.
    expect(e.text).toContain("Ha nem tudsz róla, vagy nem szeretnéd, válaszolj erre a levélre, és töröljük az adataidat.");
    expect(e.text).toContain("Amikor indul a regisztráció, kapsz egy meghívót is. Ezen kívül semmit nem küldünk, amíg magad nem regisztrálsz.");
    expect(e.text).toContain("3-4 páros csoportok");
  });

  it("needs a partner", () => {
    expect(() => partnerNotice({ ...pair, name2: null })).toThrow();
  });
});

describe("broadcastEmail", () => {
  it("fills in the name and adds the unsubscribe link", () => {
    const e = broadcastEmail(
      { subject: "Indul, {nev}!", body: "Szia {nev}!\n\nHétfőn kezdünk." },
      { name: "Anna" },
      "https://padelparbaj.hu/unsubscribe?t=abc",
    );
    expect(e.subject).toBe("Indul, Anna!");
    expect(e.text).toContain("Szia Anna!");
    expect(e.text).toContain("Leiratkozás: https://padelparbaj.hu/unsubscribe?t=abc");
    expect(e.html).toContain('href="https://padelparbaj.hu/unsubscribe?t=abc"');
  });

  it("escapes HTML the admin types", () => {
    expect(broadcastEmail({ subject: "x", body: "<img src=x>" }, { name: "A" }, "#").html).toContain(
      escapeHtml("<img src=x>"),
    );
  });
});

describe("loginCode", () => {
  it("shows the code, split for reading, in the subject and the body", () => {
    const e = loginCode("012345", 10);
    expect(e.subject).toContain("012 345");
    expect(e.text).toContain("A belépőkódod: 012 345");
    expect(e.text).toContain("10 percig");
    expect(e.html).toContain("012 345");
  });

  it("has no unsubscribe link: it is a transactional email", () => {
    expect(loginCode("123456", 10).text).not.toContain("Leiratkozás");
  });
});

describe("signupConfirmation share link", () => {
  it("asks to pass the page on, with the email's own source", () => {
    expect(signupConfirmation(pair, GYOR).text).toContain("Küldd el neki: https://padelparbaj.hu/?ref=megosztas-email");
    expect(signupConfirmation({ ...pair, mode: "solo", name2: null, email2: null }, GYOR).text).toContain(
      "könnyebb hozzád illő párt találni",
    );
    expect(signupConfirmation({ ...pair, mode: "solo", name2: null, email2: null }, GYOR).text).not.toContain(
      "játszana veled",
    );
    expect(signupConfirmation({ ...pair, city: "other", cityOther: "Pécs" }).text).toContain("a helyi padeleseknek");
  });
});

describe("pairIntro", () => {
  const anna = { name: "Nagy Anna", email: "anna@example.com", level: "kozephalado" };
  const bela = { name: "Kovács Béla", email: "bela@example.com", level: "halado" };

  it("gives the partner's name, level and email", () => {
    const e = pairIntro(anna, bela, "Győr");
    expect(e.subject).toBe("Találtunk neked párt – Padelpárbaj");
    expect(e.text).toContain("Szia Nagy Anna!");
    expect(e.text).toContain("találtunk neked párt: Kovács Béla");
    expect(e.text).toContain("A szintje: Haladó.");
    expect(e.text).toContain("Az e-mail-címe: bela@example.com");
    expect(e.text).not.toContain("anna@example.com");
    expect(e.text).toContain("Írjatok egymásnak, és játsszatok egyet. Ha összejön, a ligában párként neveztek.");
  });

  it("escapes names in the HTML", () => {
    expect(pairIntro(anna, { ...bela, name: "<b>Béla</b>" }, "Győr").html).toContain("&lt;b&gt;Béla&lt;/b&gt;");
  });
});

describe("registrationLink", () => {
  it("opens the login page with the email filled in", () => {
    expect(registrationLink("anna@example.com")).toBe("https://padelparbaj.hu/register?email=anna%40example.com");
    expect(registrationLink("a+b@example.com")).toBe("https://padelparbaj.hu/register?email=a%2Bb%40example.com");
  });
});

describe("registrationInvite", () => {
  const unsub = "https://padelparbaj.hu/unsubscribe?t=abc";
  // Győr's season: registration until Friday 6 Nov 23:59, round 1 on Monday
  // 9 Nov 2026 (00:00 Budapest).
  const start = { city: "Győr", firstRound: new Date("2026-11-08T23:00:00Z"), registrationCloses: new Date("2026-11-06T22:59:00Z") };
  const email = registrationInvite({ name: "Nagy Anna", email: "anna@example.com" }, unsub, start);

  it("thanks for signing up early, says when and where the league starts and until when to enter, then the link (#131)", () => {
    expect(email.text).toContain(
      "Szia Nagy Anna!\n\nKöszi, hogy előzetesen jelentkeztél a Padelpárbajra! A liga november 9-én indul (Győr), a nevezés november 6-ig tart. Regisztrálni és nevezni itt tudsz:\n\nhttps://padelparbaj.hu/register?email=anna%40example.com\n\n",
    );
    expect(email.text).toContain("A neved és a szinted már megvan, csak a telefonszámod kell, úgyhogy egy perc az egész.");
    expect(email.text).not.toContain("kitöltöttük");
    expect(email.html).not.toContain("kitöltöttük");
  });

  it("says only the start once registration has closed (#131)", () => {
    const e = registrationInvite({ name: "Nagy Anna", email: "anna@example.com" }, unsub, { ...start, registrationCloses: null });
    expect(e.text).toContain("A liga november 9-én indul (Győr). Regisztrálni és nevezni itt tudsz:");
    expect(e.text).not.toContain("a nevezés");
  });

  it("leaves out the start sentence without a season (#131)", () => {
    const e = registrationInvite({ name: "Nagy Anna", email: "anna@example.com" }, unsub, null);
    expect(e.text).toContain(
      "Köszi, hogy előzetesen jelentkeztél a Padelpárbajra! Regisztrálni és nevezni itt tudsz:\n\nhttps://padelparbaj.hu/register?email=anna%40example.com",
    );
    expect(e.text).not.toMatch(/indul|november/);
    expect(registrationInvite({ name: "Nagy Anna", email: "anna@example.com" }, unsub).text).toBe(e.text);
  });

  it("greets the signer and links to registration with the email filled in", () => {
    expect(email.subject).toBe("Regisztrálj a Padelpárbajra");
    expect(email.text).toContain("Szia Nagy Anna!");
    expect(email.text).toContain("https://padelparbaj.hu/register?email=anna%40example.com");
    expect(email.html).toContain('href="https://padelparbaj.hu/register?email=anna%40example.com"');
  });

  it("has an unsubscribe link: it goes to the whole list", () => {
    expect(email.text).toContain(`Leiratkozás: ${unsub}`);
    expect(email.html).toContain(unsub);
  });

  it("escapes names in the HTML", () => {
    const e = registrationInvite({ name: "<b>Anna</b>", email: "anna@example.com" }, unsub);
    expect(e.html).toContain("&lt;b&gt;Anna&lt;/b&gt;");
    expect(e.html).not.toContain("<b>Anna</b>");
  });

  it("tells a player with a partner they enter together, and promises no pair invite (#97)", () => {
    expect(email.text).toContain("Amint a párod is regisztrál, a ligában magától pár lesztek, és együtt nevezhettek a szezonra.");
    expect(email.text).not.toContain("hívhatod meg");
    expect(email.text).not.toContain("Még keresünk neked párt");
    expect(email.text).not.toContain("add meg");
  });

  it("has its own text for a solo still waiting for a partner (#96)", () => {
    const e = registrationInvite({ name: "Nagy Anna", email: "anna@example.com", variant: "solo" }, unsub, start);
    expect(e.text).toContain("Még keresünk neked párt, addig regisztrálj.");
    expect(e.text).not.toContain("a párod is regisztrál");
    expect(e.text).toContain("A liga november 9-én indul (Győr), a nevezés november 6-ig tart.");
    expect(e.text).toContain("https://padelparbaj.hu/register?email=anna%40example.com");
  });

  it("asks for the partner's address when the pair signup had none (#96, #130)", () => {
    const e = registrationInvite({ name: "Nagy Anna", email: "anna@example.com", variant: "no_partner_email" }, unsub, start);
    expect(e.text).toContain("A párod e-mail-címét nem adtad meg: belépéskor add meg, és ő is kap meghívót.");
    expect(e.text).toContain("Amint ő is regisztrál, a ligában magától pár lesztek, és együtt nevezhettek a szezonra.");
    expect(e.text).toContain("A liga november 9-én indul (Győr), a nevezés november 6-ig tart.");
  });
});

describe("the early-signup thanks (#131)", () => {
  const THANKS = "előzetesen jelentkeztél";
  const solo = { ...pair, mode: "solo", name2: null, email2: null } as const;
  const decision = {
    to: "Nagy Anna",
    partnerName: "Kovács Béla",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    joins: { phase: 1, startsAt: new Date("2026-11-08T23:00:00Z") },
  };
  const groups = {
    to: "Nagy Anna",
    partnerName: "Kovács Béla",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    phase: 1,
    group: 1,
    weeks: [{ week: 1, range: "nov. 9. – nov. 15.", opponents: null }],
    deadline: new Date("2026-11-29T22:59:00Z"),
  };
  const anna = { name: "Nagy Anna", email: "anna@example.com", level: "kezdo" };
  const bela = { name: "Kovács Béla", email: "bela@example.com", level: "kezdo" };

  it("is only in the registration invite: not in login codes, entry notices, groups, confirmations or the rest", () => {
    const others = {
      loginCode: loginCode("123456", 10),
      entered: seasonEntered(decision),
      enteredNextSeason: seasonEntered({ ...decision, joins: null }),
      groups: groupsPublished(groups),
      confirmationPair: signupConfirmation(pair, GYOR),
      confirmationSolo: signupConfirmation(solo, GYOR),
      confirmationOther: signupConfirmation({ ...pair, city: "other", cityOther: "Pécs" }),
      partnerNotice: partnerNotice(pair, GYOR),
      pairIntro: pairIntro(anna, bela, "Győr"),
    };
    for (const [name, e] of Object.entries(others)) {
      expect(e.text, name).not.toContain(THANKS);
      expect(e.html, name).not.toContain(THANKS);
    }
    expect(registrationInvite({ name: "Anna", email: "anna@example.com" }, "#").text).toContain(THANKS);
  });

  it("every email we write ends with the same sign-off", () => {
    const all = [
      loginCode("123456", 10),
      seasonEntered(decision),
      groupsPublished(groups),
      signupConfirmation(pair, GYOR),
      partnerNotice(pair, GYOR),
      pairIntro(anna, bela, "Győr"),
      registrationInvite({ name: "Anna", email: "anna@example.com" }, "#"),
    ];
    for (const e of all) expect(e.text).toContain("\n\nPéter\nPadelpárbaj\n\n--\n");
  });
});

describe("seasonEntered (#153)", () => {
  const base = {
    to: "Nagy Anna",
    partnerName: "Kovács Béla",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    joins: { phase: 1, startsAt: new Date("2026-11-08T23:00:00Z") },
  };

  it("tells the pair it's entered and starts in phase 1; no word of an approval or the organizer", () => {
    const email = seasonEntered(base);
    expect(email.subject).toBe("Beneveztetek – Padelpárbaj");
    expect(email.text).toContain("Szia Nagy Anna!");
    expect(email.text).toContain("Beneveztetek Kovács Béla pároddal (2026/27 tél, Padelpárbaj Győr).");
    expect(email.text).toContain("Az 1. körtől játszotok (kezdés: nov. 9.).");
    expect(email.html).toContain('href="https://padelparbaj.hu/pair"');
    expect(email.text).not.toMatch(/jóváhagy|szervező/i);
  });

  it("tells a late pair the phase it joins", () => {
    const email = seasonEntered({ ...base, joins: { phase: 2, startsAt: new Date("2026-11-29T23:00:00Z") } });
    expect(email.text).toContain("A 2. körtől játszotok (kezdés: nov. 30.).");
  });

  it("tells a pair with no phase left that it plays from the next season", () => {
    expect(seasonEntered({ ...base, joins: null }).text).toContain("a következő szezontól játszotok");
  });

  it("keeps the names plain text", () => {
    const email = seasonEntered({ ...base, partnerName: "<i>Béla</i>" });
    expect(email.html).toContain("&lt;i&gt;Béla&lt;/i&gt;");
  });
});

describe("groupsPublished (#24, D22)", () => {
  const base = {
    to: "Nagy Anna",
    partnerName: "Kovács Béla",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    phase: 1,
    group: 1,
    weeks: [
      { week: 1, range: "nov. 9. – nov. 15.", opponents: ["Kiss Cecil", "Tóth Dóra"] as [string, string] },
      { week: 2, range: "nov. 16. – nov. 22.", opponents: ["Szabó Emil", "Varga Flóra"] as [string, string] },
      { week: 3, range: "nov. 23. – nov. 29.", opponents: null },
    ],
    deadline: new Date("2026-11-29T22:59:00Z"),
  };

  it("tells the player their group, the opponents each week and the deadline", () => {
    const email = groupsPublished(base);
    expect(email.subject).toBe("Itt a csoportod: 1. csoport – Padelpárbaj");
    expect(email.text).toContain("Szia Nagy Anna!");
    expect(email.text).toContain(
      "Kész az 1. kör csoportbeosztása (2026/27 tél, Padelpárbaj Győr). Kovács Béla pároddal az 1. csoportban játszotok.",
    );
    expect(email.text).toContain(
      "A meccseitek:\n1. hét (nov. 9. – nov. 15.): Kiss Cecil és Tóth Dóra ellen\n2. hét (nov. 16. – nov. 22.): Szabó Emil és Varga Flóra ellen\n3. hét (nov. 23. – nov. 29.): pihenőhét",
    );
    expect(email.text).toContain("Határidő: nov. 29., vasárnap 23:59.");
    expect(email.html).toContain('href="https://padelparbaj.hu/home"');
  });

  it("has the line pointing to scheduling on the site (#26 requirement 7)", () => {
    expect(groupsPublished(base).text).toContain("Az időpontot az oldalon egyeztetitek:\n\nhttps://padelparbaj.hu/home");
  });

  it("uses the right article for the group", () => {
    expect(groupsPublished({ ...base, group: 2 }).text).toContain("pároddal a 2. csoportban játszotok.");
  });

  it("keeps the names plain text and has no contact details", () => {
    const email = groupsPublished({
      ...base,
      weeks: [{ week: 1, range: "nov. 9. – nov. 15.", opponents: ["<b>X</b>", "https://evil.example/y"] }],
    });
    expect(email.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(email.html).not.toContain('href="https://evil.example');
    expect(email.text).not.toMatch(/@|\+36/);
  });
});

describe("match scheduling emails (#26, spec 13)", () => {
  const base = {
    to: "Nagy Anna",
    opponents: "Kiss Cecil és Tóth Dóra",
    matchId: 42,
    week: 2,
    deadline: new Date("2026-11-29T22:59:00Z"),
    venue: null,
  };
  const slots = [new Date("2026-11-17T17:00:00Z"), new Date("2026-11-18T08:30:00Z"), new Date("2026-11-19T17:00:00Z")];

  it("a proposal: the slots and a one-tap link to answer", () => {
    const email = matchProposal({ ...base, counter: false, slots });
    expect(email.subject).toBe("Időpontokat ajánlottak a meccsetekre – Padelpárbaj");
    expect(email.text).toContain("Szia Nagy Anna!");
    expect(email.text).toContain(
      "Kiss Cecil és Tóth Dóra időpontokat ajánlott a 2. heti meccsetekre:\nnov. 17., kedd 18:00\nnov. 18., szerda 09:30\nnov. 19., csütörtök 18:00",
    );
    expect(email.text).toContain("Válassz egyet, vagy ajánlj másikat (határidő: nov. 29., vasárnap 23:59):");
    expect(email.html).toContain('href="https://padelparbaj.hu/matches/42"');
    expect(email.text).not.toContain("Helyszín");
    expect(email.text).toContain("\n\nPéter\nPadelpárbaj\n\n--\n");
  });

  it("a counter-proposal says so, with the venue", () => {
    const email = matchProposal({ ...base, counter: true, slots, venue: "Ace Padel" });
    expect(email.subject).toBe("Új időpontokat ajánlottak a meccsetekre – Padelpárbaj");
    expect(email.text).toContain("Kiss Cecil és Tóth Dóra új időpontokat ajánlott");
    expect(email.text).toContain("Helyszín: Ace Padel");
  });

  it("an agreed time waits for confirmation", () => {
    const email = matchAgreedTime({ ...base, slot: slots[0]! });
    expect(email.subject).toBe("Erősítsd meg a meccs időpontját – Padelpárbaj");
    expect(email.text).toContain("Kiss Cecil és Tóth Dóra rögzítette a 2. heti meccsetek megbeszélt időpontját: nov. 17., kedd 18:00.");
    expect(email.text).toContain("Erősítsd meg, vagy jelezd, ha nem így beszéltétek:");
    expect(email.html).toContain('href="https://padelparbaj.hu/matches/42"');
  });

  it("a result waits for confirmation (#28): the score, the one-tap link and the 48-hour time", () => {
    const email = matchResult({ ...base, score: "1:4, 4:2, szuper tie-break 8:10", autoAcceptAt: slots[2]! });
    expect(email.subject).toBe("Erősítsd meg a meccs eredményét – Padelpárbaj");
    expect(email.text).toContain(
      "Kiss Cecil és Tóth Dóra rögzítette a 2. heti meccsetek eredményét (ti vagytok elöl): 1:4, 4:2, szuper tie-break 8:10.",
    );
    expect(email.text).toContain("Erősítsd meg, vagy jelezd, ha nem így volt:");
    expect(email.html).toContain('href="https://padelparbaj.hu/matches/42#eredmeny"');
    expect(email.text).toContain("Ha nov. 19., csütörtök 18:00-ig nem válaszoltok, magától elfogadjuk.");
    expect(email.text).not.toMatch(/@|\+36/);
  });

  it("keeps names plain text and has no contact details", () => {
    const email = matchProposal({ ...base, opponents: "<b>X</b> és https://evil.example/y", counter: false, slots });
    expect(email.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(email.html).not.toContain('href="https://evil.example');
    expect(email.text).not.toMatch(/@|\+36/);
  });
});

describe("daily digest and holnap meccs (#31, spec 13)", () => {
  const items = [
    { title: "Lefixálva a meccsetek", body: "Az ellenfeletek elfogadta az időpontot: nov. 12., csütörtök 18:00.", url: "/matches/7" },
    { title: "Még nincs időpont-ajánlat", body: "Az 1. heti meccsetekre még senki nem ajánlott időpontot.", url: "/matches/8" },
  ];

  it("one email with every item and its one-tap link", () => {
    const email = dailyDigest({ to: "Anna", items });
    expect(email.subject).toBe("Napi összefoglaló: 2 újdonság – Padelpárbaj");
    expect(email.text).toContain("Szia Anna!");
    expect(email.text).toContain("Lefixálva a meccsetek\nAz ellenfeletek elfogadta az időpontot: nov. 12., csütörtök 18:00.");
    expect(email.text).toContain("https://padelparbaj.hu/matches/7");
    expect(email.text).toContain("https://padelparbaj.hu/matches/8");
    expect(email.html).toContain('href="https://padelparbaj.hu/matches/8"');
    expect(email.text).toContain("Az értesítéseket a profilodban állíthatod be.");
  });

  it("a single item is the subject itself", () => {
    expect(dailyDigest({ to: "Anna", items: [items[1]!] }).subject).toBe("Még nincs időpont-ajánlat – Padelpárbaj");
  });

  it("holnap meccs: time, venue, opponents and the link", () => {
    const slot = new Date("2026-11-12T17:00:00Z");
    const email = matchTomorrow({ to: "Anna", opponents: "Kiss Cili és Nagy Dani", matchId: 7, slot, venue: "Ace Padel, 2-es pálya" });
    expect(email.subject).toBe("Holnap meccs: nov. 12., csütörtök 18:00 – Padelpárbaj");
    expect(email.text).toContain("Holnap játszotok Kiss Cili és Nagy Dani ellen: nov. 12., csütörtök 18:00.");
    expect(email.text).toContain("Helyszín: Ace Padel, 2-es pálya");
    expect(email.text).toContain("https://padelparbaj.hu/matches/7");
    expect(matchTomorrow({ to: "Anna", opponents: "X és Y", matchId: 7, slot, venue: null }).text).toContain("A helyszínt még nem rögzítettétek");
  });
});

describe("pairCreated (#260, D117)", () => {
  const input = {
    to: "Nagy Anna",
    partnerName: "Kovács Béla",
    partnerEmail: "bela@example.com",
    partnerPhone: "+36 30 123 4567",
    league: "Padelpárbaj Győr",
  };

  it("names the partner and the league, and links Párom", () => {
    const e = pairCreated(input);
    expect(e.subject).toBe("Van párod – Padelpárbaj");
    expect(e.text).toContain("Szia Nagy Anna!");
    expect(e.text).toContain("A szervező párba tett: a párod Kovács Béla (Padelpárbaj Győr).");
    expect(e.text).toContain("https://padelparbaj.hu/pair");
    expect(e.html).toContain('href="https://padelparbaj.hu/pair"');
  });

  it("gives the partner's email and phone, so the two can reach each other (D117)", () => {
    const e = pairCreated(input);
    expect(e.text).toContain("Így éred el:\nE-mail: bela@example.com\nTelefon: +36 30 123 4567");
    expect(e.html).toContain("E-mail: bela@example.com<br>Telefon: +36 30 123 4567");
    const addresses = (e.text.match(/[\w.+-]+@[\w.-]+/g) ?? []).filter((a) => !a.startsWith("hello@") && !a.startsWith("info@"));
    expect(addresses).toEqual(["bela@example.com"]);
  });

  it("leaves the phone line out when the partner has none", () => {
    const e = pairCreated({ ...input, partnerPhone: "" });
    expect(e.text).toContain("Így éred el:\nE-mail: bela@example.com\n\n");
    expect(e.text).not.toContain("Telefon");
  });

  it("escapes names in the HTML", () => {
    expect(pairCreated({ ...input, partnerName: "<b>Béla</b>" }).html).toContain("&lt;b&gt;Béla&lt;/b&gt;");
    expect(pairCreated({ ...input, partnerEmail: "<x>@example.com" }).html).toContain("&lt;x&gt;@example.com");
  });
});

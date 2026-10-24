import { describe, expect, it } from "vitest";

import type { InterestSignup } from "../interest";
import {
  broadcastEmail,
  groupsPublished,
  escapeHtml,
  loginCode,
  pairAnswer,
  pairDissolved,
  pairIntro,
  pairInvite,
  partnerNotice,
  registrationInvite,
  registrationLink,
  seasonEntryDecision,
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
});

describe("partnerNotice", () => {
  it("names who signed them up and how to ask for deletion", () => {
    const e = partnerNotice(pair, GYOR);
    expect(e.subject).toBe("Nagy Anna jelentkeztetett titeket a Padelpárbajra");
    expect(e.text).toContain("Szia Kovács Béla!");
    expect(e.text).toContain("töröljük az adataidat");
    expect(e.text).toContain("nem írunk neked, amíg magad nem regisztrálsz");
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
  });

  it("escapes names in the HTML", () => {
    expect(pairIntro(anna, { ...bela, name: "<b>Béla</b>" }, "Győr").html).toContain("&lt;b&gt;Béla&lt;/b&gt;");
  });
});

describe("registrationLink", () => {
  it("opens the login page with the email filled in", () => {
    expect(registrationLink("anna@example.com")).toBe("https://padelparbaj.hu/login?email=anna%40example.com");
    expect(registrationLink("a+b@example.com")).toBe("https://padelparbaj.hu/login?email=a%2Bb%40example.com");
  });
});

describe("registrationInvite", () => {
  const unsub = "https://padelparbaj.hu/unsubscribe?t=abc";
  const email = registrationInvite({ name: "Nagy Anna", email: "anna@example.com" }, unsub);

  it("greets the signer and links to registration with the email filled in", () => {
    expect(email.subject).toBe("Regisztrálj a Padelpárbajra");
    expect(email.text).toContain("Szia Nagy Anna!");
    expect(email.text).toContain("https://padelparbaj.hu/login?email=anna%40example.com");
    expect(email.html).toContain('href="https://padelparbaj.hu/login?email=anna%40example.com"');
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
});

describe("pairInvite", () => {
  const link = "https://padelparbaj.hu/pair/invite/tok";

  it("names the inviter and the league and links to the invite", () => {
    const email = pairInvite({ inviterName: "Nagy Anna", league: "Padelpárbaj Győr", link, hasAccount: true });
    expect(email.subject).toBe("Nagy Anna meghívott párnak – Padelpárbaj");
    expect(email.text).toContain("Nagy Anna meghívott, hogy legyetek pár a Padelpárbajon (Padelpárbaj Győr).");
    expect(email.text).toContain(link);
    expect(email.html).toContain(`href="${link}"`);
    expect(email.text).not.toContain("be kell lépned");
  });

  it("tells someone without an account how to log in, and keeps the login link intact", () => {
    const login = "https://padelparbaj.hu/login?email=bela%40example.com&returnTo=%2Fpair%2Finvite%2Ftok";
    const email = pairInvite({ inviterName: "Nagy Anna", league: "Padelpárbaj Győr", link: login, hasAccount: false });
    expect(email.text).toContain(login);
    expect(email.text).toContain("Jelszó nem kell");
    // & is escaped in the attribute; a browser reads it back as &.
    expect(email.html).toContain('href="https://padelparbaj.hu/login?email=bela%40example.com&amp;returnTo=%2Fpair%2Finvite%2Ftok"');
  });

  it("never turns the inviter's name into a link: anyone can type a URL as their name", () => {
    const email = pairInvite({ inviterName: "Nyertél https://evil.example/x", league: "Győr", link, hasAccount: true });
    expect(email.html).not.toContain('href="https://evil.example');
    expect(email.html).toContain(`href="${link}"`);
  });

  it("has an unsubscribe link when given one: it goes to an address another player typed", () => {
    const unsub = "https://padelparbaj.hu/unsubscribe?t=abc";
    const email = pairInvite({ inviterName: "Nagy Anna", league: "Győr", link, hasAccount: true }, unsub);
    expect(email.text).toContain(`Leiratkozás: ${unsub}`);
  });

  it("escapes the inviter's name in the HTML", () => {
    const email = pairInvite({ inviterName: "<b>Anna</b>", league: "Győr", link, hasAccount: true });
    expect(email.html).not.toContain("<b>Anna</b>");
    expect(email.html).toContain("&lt;b&gt;Anna&lt;/b&gt;");
  });
});

describe("pairAnswer", () => {
  it("tells the inviter the invite was accepted", () => {
    const email = pairAnswer({ to: "Nagy Anna", inviteeName: "Kovács Béla", league: "Padelpárbaj Győr", accepted: true });
    expect(email.subject).toBe("Kovács Béla elfogadta a meghívásod – Padelpárbaj");
    expect(email.text).toContain("Szia Nagy Anna!");
    expect(email.text).toContain("mostantól pár vagytok (Padelpárbaj Győr)");
    expect(email.text).toContain("https://padelparbaj.hu/pair");
  });

  it("tells the inviter the invite was declined", () => {
    const email = pairAnswer({ to: "Nagy Anna", inviteeName: "Kovács Béla", league: "Padelpárbaj Győr", accepted: false });
    expect(email.subject).toBe("Kovács Béla nem fogadta el a meghívásod – Padelpárbaj");
    expect(email.text).toContain("most nem fogadta el a meghívásod (Padelpárbaj Győr). Meghívhatsz mást.");
  });
});

describe("pairDissolved", () => {
  const email = pairDissolved({ to: "Kovács Béla", dissolverName: "Nagy Anna", league: "Padelpárbaj Győr" });

  it("tells the partner who dissolved the pair and links to /pair", () => {
    expect(email.subject).toBe("Nagy Anna megszüntette a párotokat – Padelpárbaj");
    expect(email.text).toContain("Szia Kovács Béla!");
    expect(email.text).toContain("Nagy Anna megszüntette a párotokat (Padelpárbaj Győr). Új párt a Párom oldalon hívhatsz meg:");
    expect(email.text).toContain("https://padelparbaj.hu/pair");
    expect(email.html).toContain('href="https://padelparbaj.hu/pair"');
  });

  it("has no email address or phone number in it, only the contact address in the footer", () => {
    for (const part of [email.subject, email.text, email.html]) {
      const addresses = part.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [];
      expect(addresses.every((a) => a === "hello@padelparbaj.hu")).toBe(true);
      expect(part).not.toMatch(/\+36|06[ -]?\d{2}/);
    }
  });

  it("never turns the dissolver's name into a link, and escapes it", () => {
    const evil = pairDissolved({ to: "Béla", dissolverName: "<b>https://evil.example/x</b>", league: "Győr" });
    expect(evil.html).not.toContain('href="https://evil.example');
    expect(evil.html).toContain("&lt;b&gt;");
  });
});

describe("seasonEntryDecision", () => {
  const base = {
    to: "Nagy Anna",
    partnerName: "Kovács Béla",
    league: "Padelpárbaj Győr",
    season: "2026/27 tél",
    approved: true,
    joins: { phase: 1, startsAt: new Date("2026-11-08T23:00:00Z") },
    note: null,
  };

  it("tells an approved pair it starts in phase 1", () => {
    const email = seasonEntryDecision(base);
    expect(email.subject).toBe("Jóváhagyták a nevezéseteket – Padelpárbaj");
    expect(email.text).toContain("Szia Nagy Anna!");
    expect(email.text).toContain("jóváhagyta a nevezéseteket Kovács Béla pároddal (2026/27 tél, Padelpárbaj Győr).");
    expect(email.text).toContain("Az 1. körtől játszotok (kezdés: nov. 9.).");
    expect(email.html).toContain('href="https://padelparbaj.hu/pair"');
    expect(email.text).not.toContain("üzenete");
  });

  it("tells a late pair the phase it joins", () => {
    const email = seasonEntryDecision({ ...base, joins: { phase: 2, startsAt: new Date("2026-11-29T23:00:00Z") } });
    expect(email.text).toContain("a 2. körtől játszotok (kezdés: nov. 30.)");
  });

  it("tells a pair approved in the last phase that it moves into the next season", () => {
    expect(seasonEntryDecision({ ...base, joins: null }).text).toContain("a következő szezontól játszotok");
  });

  it("tells a rejected pair, with the organizer's note", () => {
    const email = seasonEntryDecision({ ...base, approved: false, joins: null, note: "Most tele vagyunk." });
    expect(email.subject).toBe("Nem fogadták el a nevezéseteket – Padelpárbaj");
    expect(email.text).toContain("most nem fogadta el a nevezéseteket");
    expect(email.text).toContain("A szervező üzenete:\nMost tele vagyunk.");
    expect(email.text).not.toContain("körtől");
  });

  it("keeps the note and the names plain text", () => {
    const email = seasonEntryDecision({ ...base, partnerName: "<i>Béla</i>", note: "Nézd meg: https://evil.example/x" });
    expect(email.html).not.toContain('href="https://evil.example');
    expect(email.html).toContain("&lt;i&gt;Béla&lt;/i&gt;");
    expect(email.text).toContain("https://evil.example/x");
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

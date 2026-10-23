import { describe, expect, it } from "vitest";

import type { InterestSignup } from "../interest";
import {
  broadcastEmail,
  escapeHtml,
  loginCode,
  pairIntro,
  partnerNotice,
  registrationInvite,
  registrationLink,
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

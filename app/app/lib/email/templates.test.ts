import { describe, expect, it } from "vitest";

import type { InterestSignup } from "../interest";
import { broadcastEmail, escapeHtml, loginCode, partnerNotice, signupConfirmation, textToHtml } from "./templates";

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
    expect(textToHtml("Nézd: https://padelparbaj.hu/szabalyzat.")).toContain(
      '<a href="https://padelparbaj.hu/szabalyzat" style="color:#1e5ba8">https://padelparbaj.hu/szabalyzat</a>.',
    );
  });

  it("does not turn an escaped javascript: text into a link", () => {
    expect(textToHtml('javascript:alert("x")')).not.toContain("<a");
  });
});

describe("signupConfirmation", () => {
  it("greets the signer and summarises the signup", () => {
    const e = signupConfirmation(pair);
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
    const e = partnerNotice(pair);
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
      "https://padelparbaj.hu/leiratkozas?t=abc",
    );
    expect(e.subject).toBe("Indul, Anna!");
    expect(e.text).toContain("Szia Anna!");
    expect(e.text).toContain("Leiratkozás: https://padelparbaj.hu/leiratkozas?t=abc");
    expect(e.html).toContain('href="https://padelparbaj.hu/leiratkozas?t=abc"');
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

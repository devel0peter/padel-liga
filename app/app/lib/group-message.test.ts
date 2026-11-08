import { describe, expect, it } from "vitest";

import { groupMessage, mailtoHref, messageSubject, messageText, smsHref, smsPlatform } from "./group-message";

const PHONES = ["+36 30 123 4567", "+36 20 765 4321", "+36 1 234 5678"];
const TEXT = { week: 3, us: ["Anna Teszt", "Béla Próba"], them: ["Cili Ős", "Dénes Úr"], url: "https://padelparbaj.hu/matches/42" };

describe("smsPlatform (D147)", () => {
  it("iPhone, iPad and iPod are iOS", () => {
    expect(smsPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15")).toBe("ios");
    expect(smsPlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("ios");
    expect(smsPlatform("Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)")).toBe("ios");
  });

  it("a Mac with a touch screen is an iPad (iPadOS), without one a Mac", () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(smsPlatform(mac, 5)).toBe("ios");
    expect(smsPlatform(mac, 0)).toBe("android");
    expect(smsPlatform(mac)).toBe("android");
  });

  it("Android and anything else take the default form", () => {
    expect(smsPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36", 5)).toBe("android");
    expect(smsPlatform("")).toBe("android");
  });
});

describe("smsHref (D147)", () => {
  it("Android: the numbers in E.164 after sms:, the body encoded", () => {
    expect(smsHref(PHONES, "Szia!", "android")).toBe("sms:+36301234567,+36207654321,+3612345678?body=Szia!");
  });

  it("iOS: /open?addresses=", () => {
    expect(smsHref(PHONES, "Szia!", "ios")).toBe("sms:/open?addresses=+36301234567,+36207654321,+3612345678&body=Szia!");
  });

  it("encodes Hungarian letters, spaces, newlines, & and ?", () => {
    const href = smsHref(["+36301234567"], "Mikor értek rá?\nŐ & ű", "android")!;
    expect(href).toBe("sms:+36301234567?body=Mikor%20%C3%A9rtek%20r%C3%A1%3F%0A%C5%90%20%26%20%C5%B1");
    expect(decodeURIComponent(href.split("body=")[1]!)).toBe("Mikor értek rá?\nŐ & ű");
  });

  it("no number: no link", () => {
    expect(smsHref([], "Szia!", "android")).toBeNull();
    expect(smsHref(["", " "], "Szia!", "ios")).toBeNull();
  });
});

describe("mailtoHref (D147)", () => {
  it("every address, the subject and the body, encoded", () => {
    expect(mailtoHref(["a@x.hu", "b+liga@y.hu"], "Padelpárbaj: 3. heti meccs", "Szia!\nMikor?")).toBe(
      "mailto:a@x.hu,b%2Bliga@y.hu?subject=Padelp%C3%A1rbaj%3A%203.%20heti%20meccs&body=Szia!%0AMikor%3F",
    );
  });

  it("no address: no link", () => {
    expect(mailtoHref([], "s", "b")).toBeNull();
    expect(mailtoHref([""], "s", "b")).toBeNull();
  });
});

describe("the text (D147)", () => {
  it("subject: the week", () => {
    expect(messageSubject(3)).toBe("Padelpárbaj: 3. heti meccs");
  });

  it("body: the week, both pairs, and the reminder with the match link", () => {
    expect(messageText(TEXT)).toBe(
      "Szia! A Padelpárbaj 3. heti meccsünkről írok (Anna Teszt és Béla Próba – Cili Ős és Dénes Úr). " +
        "Mikor értek rá? Ha megvan az időpont, rögzítsük az appban is: https://padelparbaj.hu/matches/42",
    );
  });
});

describe("groupMessage (D147)", () => {
  const all = [
    { name: "Béla Próba", phone: PHONES[0]!, email: "b@x.hu" },
    { name: "Cili Ős", phone: PHONES[1]!, email: "c@x.hu" },
    { name: "Dénes Úr", phone: PHONES[2]!, email: "d@x.hu" },
  ];

  it("everyone reachable: both links, the numbers as shown, nobody missing", () => {
    const m = groupMessage(all, TEXT, "android");
    expect(m.sms).toBe(`sms:+36301234567,+36207654321,+3612345678?body=${encodeURIComponent(messageText(TEXT))}`);
    expect(m.mailto).toBe(
      `mailto:b@x.hu,c@x.hu,d@x.hu?subject=${encodeURIComponent(messageSubject(3))}&body=${encodeURIComponent(messageText(TEXT))}`,
    );
    expect(m.phones).toBe("+36 30 123 4567, +36 20 765 4321, +36 1 234 5678");
    expect(m.noPhone).toEqual([]);
    expect(m.noEmail).toEqual([]);
  });

  it("someone without a number: left out of the SMS and the copy, named", () => {
    const m = groupMessage([all[0]!, { ...all[1]!, phone: "" }, all[2]!], TEXT, "ios");
    expect(m.sms).toMatch(/^sms:\/open\?addresses=\+36301234567,\+3612345678&body=/);
    expect(m.phones).toBe("+36 30 123 4567, +36 1 234 5678");
    expect(m.noPhone).toEqual(["Cili Ős"]);
    expect(m.mailto).toContain("c@x.hu");
  });

  it("someone without an address: left out of the email, named", () => {
    const m = groupMessage([all[0]!, { ...all[1]!, email: null }], TEXT, "android");
    expect(m.mailto).toMatch(/^mailto:b@x\.hu\?subject=/);
    expect(m.noEmail).toEqual(["Cili Ős"]);
  });

  it("nobody has a number: no SMS, nothing to copy", () => {
    const m = groupMessage(
      all.map((r) => ({ ...r, phone: "" })),
      TEXT,
      "android",
    );
    expect(m.sms).toBeNull();
    expect(m.phones).toBe("");
    expect(m.noPhone).toHaveLength(3);
  });

  it("nobody at all: nothing", () => {
    const m = groupMessage([], TEXT, "android");
    expect(m).toEqual({ sms: null, mailto: null, phones: "", noPhone: [], noEmail: [] });
  });
});

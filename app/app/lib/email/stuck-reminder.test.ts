// The three reminder texts (#155), word for word: they are the final text
// Peter reviews in the PR. (A, the registration invite's reminder, went with
// the interest list: #333, D129.)
import { describe, expect, it } from "vitest";

import { stuckReminder, type StuckReminderInput } from "./templates";

const NOW = new Date("2026-11-02T12:00:00Z");
const base: Omit<StuckReminderInput, "situation"> = {
  to: "Anna",
  partner: null,
  league: "Padelpárbaj Győr",
  season: "2026/27 tél",
  // Friday 6 Nov 23:59 Budapest; phase 1 Monday 9 Nov.
  deadline: new Date("2026-11-06T22:59:00Z"),
  nextRound: { number: 1, startsAt: new Date("2026-11-08T23:00:00Z") },
  pairLink: null,
  now: NOW,
};
const UNSUB = "https://padelparbaj.hu/unsubscribe?t=abc";
const body = (input: StuckReminderInput) => stuckReminder(input, UNSUB).text.split("\n\n--\n")[0];

describe("stuckReminder", () => {
  it("B: finish the registration", () => {
    const email = stuckReminder({ ...base, situation: "B" }, UNSUB);
    expect(email.subject).toBe("Fejezd be a regisztrációt – Padelpárbaj");
    expect(body({ ...base, situation: "B" })).toBe(
      [
        "Szia Anna!",
        "Elkezdted a regisztrációt a Padelpárbajon, de még nem fejezted be. Lépj be, és add meg a neved, a szinted és a telefonszámod:",
        "https://padelparbaj.hu/login",
        "Nevezési határidő: nov. 6., péntek 23:59. Az 1. kör nov. 9., hétfő indul.",
        "Péter\nPadelpárbaj",
      ].join("\n\n"),
    );
    // An account without a name yet.
    expect(body({ ...base, situation: "B", to: "" })).toMatch(/^Szia!\n/);
  });

  it("C: send the pair link, or switch on Párt keresek", () => {
    const input = { ...base, situation: "C" as const, pairLink: "https://padelparbaj.hu/pair/join/tok" };
    expect(stuckReminder(input, UNSUB).subject).toBe("Hívd meg a párodat – Padelpárbaj");
    expect(body(input)).toBe(
      [
        "Szia Anna!",
        "Még nincs párod (Padelpárbaj Győr). A „Hívd meg a párodat” kártyán van a saját linked: küldd el a párodnak. Ha megnyitja és regisztrál, párban vagytok, és nevezhettek.",
        "https://padelparbaj.hu/pair/join/tok",
        "Ha nincs kivel játszanod, a Párom oldalon kapcsold be a „Párt keresek” kapcsolót, és a szervező keres neked párt:",
        "https://padelparbaj.hu/pair",
        "Nevezési határidő: nov. 6., péntek 23:59. Az 1. kör nov. 9., hétfő indul.",
        "Péter\nPadelpárbaj",
      ].join("\n\n"),
    );
  });

  it("D: one of you presses Nevezünk", () => {
    const input = { ...base, situation: "D" as const, partner: "Béla" };
    expect(stuckReminder(input, UNSUB).subject).toBe("Nevezzetek a szezonra – Padelpárbaj");
    expect(body(input)).toBe(
      [
        "Szia Anna!",
        "Béla pároddal még nem neveztetek (2026/27 tél, Padelpárbaj Győr). Egyikőtök nyomja meg a „Nevezünk” gombot a Párom oldalon:",
        "https://padelparbaj.hu/pair",
        "Nevezési határidő: nov. 6., péntek 23:59. Az 1. kör nov. 9., hétfő indul.",
        "Péter\nPadelpárbaj",
      ].join("\n\n"),
    );
  });

  it("after the deadline, with late entry still open, gives only the next round", () => {
    const late = { ...base, now: new Date("2026-11-20T12:00:00Z"), nextRound: { number: 2, startsAt: new Date("2026-11-29T23:00:00Z") } };
    expect(body({ ...late, situation: "D", partner: "Béla" })).toContain("A határidő lejárt, de még beszállhattok: a 2. kör nov. 30., hétfő indul.");
    expect(body({ ...late, situation: "C" })).toContain("A határidő lejárt, de még beszállhatsz: a 2. kör nov. 30., hétfő indul.");
  });

  it("has an unsubscribe link and a link only where we put one", () => {
    for (const situation of ["B", "C", "D"] as const) {
      const email = stuckReminder({ ...base, situation, to: "<b>X</b>", partner: "https://evil.example" }, UNSUB);
      expect(email.text).toContain(`Leiratkozás: ${UNSUB}`);
      expect(email.html).toContain(`href="${UNSUB}"`);
      expect(email.html).not.toContain('href="https://evil.example');
      expect(email.html).toContain("&lt;b&gt;X&lt;/b&gt;");
    }
  });

  it("holds no address and no phone number", () => {
    for (const situation of ["B", "C", "D"] as const) {
      const { text, html } = stuckReminder({ ...base, situation, partner: "Béla", pairLink: "https://padelparbaj.hu/pair/join/tok" }, UNSUB);
      for (const s of [text, html]) {
        expect(s).not.toMatch(/@|%40/);
        expect(s).not.toMatch(/\+36|06\d{8}/);
      }
    }
  });
});

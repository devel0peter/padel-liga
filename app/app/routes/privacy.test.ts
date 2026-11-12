// The privacy page (spec section 17) after the interest list's deletion
// (#334, D132): it no longer describes the landing page's signup data, solo
// signups, a partner's data from a signup or the list's retention, and its
// bot check line names the login code step. The feedback lines (#250) say
// what the form stores, who sees it, why, how long and that we don't reply.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";

const { default: Privacy } = await import("~/routes/privacy");

function page(): string {
  const Stub = createRoutesStub([{ path: "/privacy", Component: () => createElement(Privacy, {} as any) }]);
  // Text only, whitespace folded, so line breaks in the source don't matter.
  return renderToStaticMarkup(createElement(Stub, { initialEntries: ["/privacy"] }))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

describe("privacy page (#334)", () => {
  const text = page();

  it("says nothing about the interest list any more", () => {
    for (const gone of [
      "Jelentkezési lista",
      "jelentkezési listát",
      "a jelentkezéskor",
      "Ha a párodat is jelentkezteted",
      "Ha egyedül jelentkezel",
      "jelentkezésed visszaigazolását",
      "jelentkezési űrlap",
      "megkaptad a meghívót",
      "plakátjáról",
      "szívesen szerveznél",
    ])
      expect(text, gone).not.toContain(gone);
    expect(text).not.toMatch(/jelentkez/i);
  });

  it("names the login code's bot check and keeps the other retention lines", () => {
    expect(text).toContain("a belépési kód kérésének meg a belépés nélkül küldött visszajelzésnek a robotszűrője (Turnstile)");
    for (const kept of ["Fiókok:", "Levelek:", "Belépési kód:", "Technikai napló:", "Biztonsági mentés:"]) expect(text).toContain(kept);
  });

  it("says who sees the phone number and the email address as spec 17 does (D121, D126)", () => {
    expect(text).toContain("A párod látja az e-mail-címedet és a telefonszámodat a Profil oldalon");
    expect(text).toContain("szintjét és telefonszámát látja, az e-mail-címeteket nem");
    expect(text).not.toContain("a párod csak a neved látja");
    expect(text).not.toContain("az e-mail-címe és a telefonszáma nélkül");
  });

  it("lists the leagues an account joined (D128)", () => {
    expect(text).toContain("melyik ligákhoz csatlakoztál");
  });
});

describe("privacy page: feedback (#250, spec 17 and 19)", () => {
  const text = page();

  it("says what the feedback form stores, and what it doesn't", () => {
    expect(text).toContain("Ha visszajelzést küldesz (a Visszajelzés oldalon, belépve vagy anélkül)");
    for (const item of [
      "az üzenetedet",
      "a típusát (hiba, ötlet vagy egyéb)",
      "az oldalt, ahonnan küldted",
      "az idejét",
      "az eszközöd típusát (mobil vagy számítógép) és a böngésződ nevét",
      "az oldal verzióját",
      "ha be vagy lépve, a fiókodat",
    ])
      expect(text, item).toContain(item);
    expect(text).toContain("A teljes böngészőazonosítót és az IP-címedet nem tároljuk.");
  });

  it("says only the Admin sees it, why it is kept, and that we don't reply by email", () => {
    expect(text).toContain("A visszajelzésedet csak az oldal adminja látja");
    expect(text).toContain("A visszajelzést te küldöd el, önként.");
    expect(text).toContain("kijavítsuk a hibákat és jobbá tegyük az oldalt");
    expect(text).toMatch(/E-mailben nem válaszolunk rá; ha kérdésed van, írj a \S+@\S+ címre\./);
  });

  it("keeps it a year, or until the account is deleted", () => {
    expect(text).toContain("Visszajelzések: egy évig őrizzük, utána magától törlődik.");
    expect(text).toContain("a belépve küldött visszajelzéseidet vele együtt töröljük");
  });

  it("names no bug report processor: GitHub isn't used yet (#246 not built)", () => {
    expect(text).not.toMatch(/github/i);
  });
});

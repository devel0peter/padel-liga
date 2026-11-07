// The privacy page (spec section 17) after the interest list's deletion
// (#334, D132): it no longer describes the landing page's signup data, solo
// signups, a partner's data from a signup or the list's retention, and its
// bot check line names the login code step.
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
    expect(text).toContain("a belépési kód kérésének robotszűrője (Turnstile)");
    for (const kept of ["Fiókok:", "Levelek:", "Belépési kód:", "Technikai napló:", "Biztonsági mentés:"]) expect(text).toContain(kept);
  });

  it("says who sees the phone number and the email address as spec 17 does (D121, D126)", () => {
    expect(text).toContain("A párod látja az e-mail-címedet és a telefonszámodat a Párom oldalon");
    expect(text).toContain("szintjét és telefonszámát látja, az e-mail-címeteket nem");
    expect(text).not.toContain("a párod csak a neved látja");
    expect(text).not.toContain("az e-mail-címe és a telefonszáma nélkül");
  });

  it("lists the leagues an account joined (D128)", () => {
    expect(text).toContain("melyik ligákhoz csatlakoztál");
  });
});

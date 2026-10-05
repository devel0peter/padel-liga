import { describe, expect, it } from "vitest";

import { SHARE_REFS, shareLinks, shareText, shareUrl } from "./share";

describe("share", () => {
  it("links the landing page with its own source", () => {
    expect(shareUrl(SHARE_REFS.page)).toBe("https://padelparbaj.hu/?ref=megosztas");
    expect(shareUrl(SHARE_REFS.email)).toBe("https://padelparbaj.hu/?ref=megosztas-email");
  });

  it("asks for a partner when signed up alone", () => {
    expect(shareText("solo", "Győr")).toBe(
      "Párt keresek a Padelpárbajra (Győr), heti padel ligára pároknak. Gyere velem, vagy jelentkezz te is:",
    );
    expect(shareText("pair", "Győr")).toBe("Indul a Padelpárbaj (Győr), heti padel liga pároknak. Jelentkezz te is:");
    expect(shareText("pair", null)).toBe("Indul a Padelpárbaj, heti padel liga pároknak. Jelentkezz te is:");
  });

  it("builds WhatsApp and Facebook links with the text and the url encoded", () => {
    const url = shareUrl(SHARE_REFS.page);
    const links = shareLinks(url, "Gyere, játsszunk!");
    expect(links.whatsapp).toBe(`https://wa.me/?text=${encodeURIComponent(`Gyere, játsszunk! ${url}`)}`);
    expect(links.facebook).toBe(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`);
  });
});

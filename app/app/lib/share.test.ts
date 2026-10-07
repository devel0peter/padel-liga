import { describe, expect, it } from "vitest";

import { SHARE_REFS, shareLinks, shareText, shareUrl } from "./share";

describe("share", () => {
  it("links the landing page with its own source", () => {
    expect(shareUrl(SHARE_REFS.page)).toBe("https://padelparbaj.hu/?ref=megosztas");
    expect(shareUrl(SHARE_REFS.email)).toBe("https://padelparbaj.hu/?ref=megosztas-email");
  });

  it("says you can sign up alone when shared by a solo player", () => {
    expect(shareText("solo", "Győr")).toBe(
      "Indul a Padelpárbaj (Győr), heti padel liga pároknak. Párral vagy egyedül is jelentkezhetsz:",
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

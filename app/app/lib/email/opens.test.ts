import { describe, expect, it } from "vitest";

import {
  isOpenToken,
  newOpenToken,
  OPEN_IMAGE_HEADERS,
  openImageUrl,
  openStatus,
  TRANSPARENT_GIF,
  tracksOpens,
  withOpenImage,
} from "./opens";

describe("tracksOpens (#243)", () => {
  it("tracks every kind except a login code", () => {
    expect(tracksOpens("login_code")).toBe(false);
    for (const kind of ["groups_published", "broadcast", "stuck_reminder", "match_proposal", "pair_created", "round_extended"] as const)
      expect(tracksOpens(kind)).toBe(true);
  });
});

describe("newOpenToken (#243)", () => {
  it("is 32 hex characters, a fresh one each time", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newOpenToken()));
    expect(tokens.size).toBe(200);
    for (const t of tokens) expect(isOpenToken(t)).toBe(true);
  });

  it("refuses anything else: an id, an address, the wrong length or case", () => {
    for (const t of ["", "42", "anna@x.hu", "a".repeat(31), "a".repeat(33), "A".repeat(32), `${"a".repeat(31)}/`]) expect(isOpenToken(t)).toBe(false);
  });
});

describe("withOpenImage (#243)", () => {
  const url = openImageUrl("https://padelparbaj.hu", "0".repeat(32));

  it("points at /email/open/<token>", () => {
    expect(url).toBe(`https://padelparbaj.hu/email/open/${"0".repeat(32)}`);
  });

  it("puts a 1x1 image with no alt text just before </body>", () => {
    const html = withOpenImage("<html><body><p>Szia</p>\n</body>\n</html>", url);
    expect(html).toBe(
      `<html><body><p>Szia</p>\n<img src="${url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0">\n</body>\n</html>`,
    );
  });

  it("appends it to HTML without a body tag, and leaves an empty HTML empty", () => {
    expect(withOpenImage("<p>Szia</p>", url)).toBe(`<p>Szia</p><img src="${url}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;margin:0;padding:0">`);
    expect(withOpenImage("", url)).toBe("");
  });
});

describe("the image answer (#243)", () => {
  it("is a GIF89a that nobody may cache", () => {
    expect(new TextDecoder().decode(TRANSPARENT_GIF.slice(0, 6))).toBe("GIF89a");
    expect(TRANSPARENT_GIF.length).toBe(42);
    expect(OPEN_IMAGE_HEADERS["Content-Type"]).toBe("image/gif");
    expect(OPEN_IMAGE_HEADERS["Cache-Control"]).toContain("no-store");
  });
});

describe("openStatus (#243)", () => {
  const sent = { tracked: true, status: "sent", openedAt: null, openCount: 0 };

  it("an unopened tracked email: nobody knows", () => {
    expect(openStatus(sent)).toBe("Nem ismert, hogy megnyitotta");
  });

  it("an opened one: the first open in Budapest time and the count", () => {
    expect(openStatus({ ...sent, openedAt: new Date("2026-11-12T17:05:00Z"), openCount: 3 })).toBe("Megnyitva: 2026. 11. 12. 18:05 · 3 megnyitás");
  });

  it("nothing for an untracked email (a login code, one from before) or one not sent yet", () => {
    expect(openStatus({ ...sent, tracked: false })).toBeNull();
    for (const status of ["pending", "sending", "failed"]) expect(openStatus({ ...sent, status })).toBeNull();
  });
});

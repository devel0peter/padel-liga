import { describe, expect, it } from "vitest";

import { organizationJsonLd, pageMeta } from "./site";

describe("pageMeta", () => {
  const meta = pageMeta({ title: "Cím", description: "Leírás", path: "/rules" });
  const prop = (p: string) => meta.find((m) => "property" in m && m.property === p);

  it("keeps title and description", () => {
    expect(meta).toContainEqual({ title: "Cím" });
    expect(meta).toContainEqual({ name: "description", content: "Leírás" });
  });

  it("adds absolute Open Graph URLs for link previews", () => {
    expect(prop("og:url")).toEqual({ property: "og:url", content: "https://padelparbaj.hu/rules" });
    expect(prop("og:image")).toEqual({ property: "og:image", content: "https://padelparbaj.hu/og.png" });
    expect(prop("og:locale")).toEqual({ property: "og:locale", content: "hu_HU" });
  });

  it("puts the query on og:url only, so a tagged link's preview keeps its tag", () => {
    const tagged = pageMeta({ title: "Cím", description: "Leírás", path: "/", ogQuery: "?ref=klub-fb" });
    expect(tagged).toContainEqual({ property: "og:url", content: "https://padelparbaj.hu/?ref=klub-fb" });
    expect(tagged).toContainEqual({ tagName: "link", rel: "canonical", href: "https://padelparbaj.hu/" });
  });
});

describe("organizationJsonLd", () => {
  const { "script:ld+json": data } = organizationJsonLd();
  const ofType = (t: string) => data["@graph"].find((n) => n["@type"] === t);

  it("describes the league as a sports organization with absolute URLs", () => {
    expect(data["@context"]).toBe("https://schema.org");
    expect(ofType("SportsOrganization")).toMatchObject({
      name: "Padelpárbaj",
      url: "https://padelparbaj.hu/",
      logo: "https://padelparbaj.hu/icon-512.png",
      sport: "Padel",
    });
  });

  it("points to the Facebook page", () => {
    expect(ofType("SportsOrganization")).toMatchObject({ sameAs: ["https://www.facebook.com/padelparbaj"] });
  });

  it("links the website to its publisher", () => {
    expect(ofType("WebSite")).toMatchObject({ inLanguage: "hu", publisher: { "@id": "https://padelparbaj.hu/#org" } });
  });
});

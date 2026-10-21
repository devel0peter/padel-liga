// Site-wide constants shown on public pages.

export const SITE_NAME = "Padelpárbaj";
export const SITE_URL = "https://padelparbaj.hu";
export const CONTACT_EMAIL = "hello@padelparbaj.hu";
export const FACEBOOK_URL = "https://www.facebook.com/padelparbaj";

// Data controller named on the privacy page (README decision log, 2026-10-01).
export const DATA_CONTROLLER = {
  name: "Psionic Flare Kft.",
  taxNumber: "29268782-2-19",
  seat: "8456 Noszlop, Szabadság utca 38.",
};

// Title, description and link preview (Open Graph) tags for a public page.
// The image is public/og.png, made from scripts/og-image.html. `ogQuery`
// (e.g. "?ref=x") goes on og:url only; the canonical link stays bare.
export function pageMeta({
  title,
  description,
  path,
  ogQuery = "",
}: {
  title: string;
  description: string;
  path: string;
  ogQuery?: string;
}) {
  const url = `${SITE_URL}${path}`;
  return [
    { title },
    { name: "description", content: description },
    { tagName: "link", rel: "canonical", href: url },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: "hu_HU" },
    { property: "og:url", content: `${url}${ogQuery}` },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:image", content: `${SITE_URL}/og.png` },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: `${SITE_NAME}: Ki a legjobb páros a városban?` },
    { name: "twitter:card", content: "summary_large_image" },
  ];
}

// Structured data (schema.org JSON-LD) for the landing page: who we are, for
// search engines and AI search. No SportsEvent yet: the start date depends on
// enough pairs signing up, and a wrong date there is worse than none.
export function organizationJsonLd() {
  return {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "SportsOrganization",
          "@id": `${SITE_URL}/#org`,
          name: SITE_NAME,
          url: `${SITE_URL}/`,
          logo: `${SITE_URL}/icon-512.png`,
          image: `${SITE_URL}/og.png`,
          email: CONTACT_EMAIL,
          sameAs: [FACEBOOK_URL],
          sport: "Padel",
          areaServed: { "@type": "Country", name: "Magyarország" },
          description:
            "Városi padel liga pároknak: szint szerinti 4-es csoportok, heti egy meccs, feljutás és kiesés.",
        },
        {
          "@type": "WebSite",
          "@id": `${SITE_URL}/#website`,
          name: SITE_NAME,
          url: `${SITE_URL}/`,
          inLanguage: "hu",
          publisher: { "@id": `${SITE_URL}/#org` },
        },
      ],
    },
  };
}

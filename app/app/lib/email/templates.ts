// Email content. Pure (no I/O) so it can be unit tested and previewed in the
// browser. Every email has an HTML and a plain-text version.

import type { InterestSignup } from "../interest";
import { cityLabel, levelLabel } from "../signups-admin";
import { CONTACT_EMAIL, SITE_NAME } from "../site";

export const SITE_URL = "https://padelparbaj.hu";

export type Email = { subject: string; html: string; text: string };

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Plain text to HTML: blank lines split paragraphs, single newlines become
// <br>, and http(s) URLs become links. Everything else is escaped.
export function textToHtml(text: string): string {
  const linkify = (s: string) =>
    s.replace(
      /https?:\/\/[^\s<]+[^\s<.,;:!?)"']/g,
      (url) => `<a href="${url}" style="color:#1e5ba8">${url}</a>`,
    );
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p style="margin:0 0 16px">${linkify(escapeHtml(p.trim())).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

function layout(bodyHtml: string, footerHtml: string): string {
  return `<!doctype html>
<html lang="hu">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f6f9">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#10233d">
<div style="font-weight:800;font-size:18px;margin-bottom:16px"><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#dceb3c;margin-right:8px"></span>${SITE_NAME}</div>
<div style="background:#ffffff;border-radius:12px;padding:24px">
${bodyHtml}
</div>
<div style="font-size:13px;color:#5b6b80;padding:16px 4px">${footerHtml}</div>
</div>
</body>
</html>`;
}

const privacyLink = `${SITE_URL}/adatkezeles`;

function footer(reason: string, unsubscribeUrl?: string): { html: string; text: string } {
  const html = [
    escapeHtml(reason),
    `<a href="${privacyLink}" style="color:#5b6b80">Adatkezelési tájékoztató</a>`,
    unsubscribeUrl ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#5b6b80">Leiratkozás</a>` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const text = [
    reason,
    `Adatkezelési tájékoztató: ${privacyLink}`,
    unsubscribeUrl ? `Leiratkozás: ${unsubscribeUrl}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return { html, text };
}

function build(subject: string, bodyText: string, foot: { html: string; text: string }): Email {
  return {
    subject,
    html: layout(textToHtml(bodyText), foot.html),
    text: `${bodyText.trim()}\n\n--\n${foot.text}\n`,
  };
}

const SIGNATURE = `Peter\n${SITE_NAME}`;

export function signupConfirmation(s: InterestSignup): Email {
  const otherCity = s.cityOther != null;
  const lines = [
    `Város: ${cityLabel(s)}`,
    s.mode === "pair" && s.name2 ? `Párod: ${s.name2}` : "Egyedül jelentkeztél, párt keresel",
    `Szint: ${levelLabel(s.level)}`,
  ];
  const next = otherCity
    ? `Ott, ahol játszanál (${s.cityOther}), még nincs liga. Ha lesz szervező, és elég pár összegyűlik, szólunk.`
    : s.mode === "solo"
      ? "Segítünk párt találni. Amint elég pár összegyűlik, írunk az indulásról."
      : "Amint elég pár összegyűlik, írunk az indulásról és a következő lépésekről.";

  return build(
    `Megkaptuk a jelentkezésed – ${SITE_NAME}`,
    [
      `Szia ${s.name1}!`,
      `Köszi, megkaptuk a jelentkezésed.`,
      lines.join("\n"),
      next,
      `Ha valamit rosszul adtál meg, vagy meggondoltad magad, csak válaszolj erre a levélre.`,
      SIGNATURE,
    ].join("\n\n"),
    footer(`Azért kaptad ezt a levelet, mert jelentkeztél a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// Spec section 17: the partner gets exactly one email, so they know about the
// signup and can ask for deletion.
export function partnerNotice(s: InterestSignup): Email {
  if (!s.name2) throw new Error("partnerNotice needs a partner");
  return build(
    `${s.name1} jelentkeztetett titeket a ${SITE_NAME}ra`,
    [
      `Szia ${s.name2}!`,
      `${s.name1} párként jelentkeztetett kettőtöket a ${SITE_NAME}ra (${cityLabel(s)}), és megadta a neved és az e-mail-címed.`,
      `A ${SITE_NAME} padelbajnokság pároknak: szint szerinti 4-es csoportok, heti egy meccs, feljutás és kiesés. Részletek: ${SITE_URL}`,
      `Ha nem tudsz róla, vagy nem szeretnéd, válaszolj erre a levélre, és töröljük az adataidat. Ezen kívül nem írunk neked, amíg magad nem regisztrálsz.`,
      SIGNATURE,
    ].join("\n\n"),
    footer(`Ezt az egy levelet azért kaptad, mert ${s.name1} megadta a címedet. Kapcsolat: ${CONTACT_EMAIL}`),
  );
}

// "{nev}" in the subject or body is replaced with the recipient's name.
export const NAME_PLACEHOLDER = "{nev}";

export function broadcastEmail(
  draft: { subject: string; body: string },
  recipient: { name: string },
  unsubscribeUrl: string,
): Email {
  const fill = (s: string) => s.replaceAll(NAME_PLACEHOLDER, recipient.name);
  return build(
    fill(draft.subject),
    fill(draft.body),
    footer(`Azért kaptad ezt a levelet, mert jelentkeztél a ${SITE_NAME}ra.`, unsubscribeUrl),
  );
}

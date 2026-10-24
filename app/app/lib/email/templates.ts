// Email content. Pure (no I/O) so it can be unit tested and previewed in the
// browser. Every email has an HTML and a plain-text version.

import type { City } from "../cities";
import { formatShortDate } from "../format";
import type { InterestSignup } from "../interest";
import { cityLabel, levelLabel } from "../signups-admin";
import { SHARE_REFS, shareUrl } from "../share";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "../site";

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

// The wordmark (components/site.tsx): "Padel" heavy, "párbaj" light.
const WORDMARK_HTML = `<span style="font-weight:800">Padel</span><span style="font-weight:300">párbaj</span>`;

function layout(bodyHtml: string, footerHtml: string): string {
  return `<!doctype html>
<html lang="hu">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f4f6f9">
<div style="max-width:560px;margin:0 auto;padding:24px 16px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.5;color:#10233d">
<div style="font-weight:800;font-size:18px;margin-bottom:16px"><span style="display:inline-block;width:12px;height:12px;border-radius:6px;background:#dceb3c;margin-right:8px"></span>${WORDMARK_HTML}</div>
<div style="background:#ffffff;border-radius:12px;padding:24px">
${bodyHtml}
</div>
<div style="font-size:13px;color:#5b6b80;padding:16px 4px">${footerHtml}</div>
</div>
</body>
</html>`;
}

const privacyLink = `${SITE_URL}/privacy`;

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

// Like build(), for a body with text another player typed (a name): only the
// paragraphs in `links` become links, so a name like "https://…" stays text
// in an email we send to any address.
function buildPlain(subject: string, paragraphs: string[], links: string[], foot: { html: string; text: string }): Email {
  const html = paragraphs
    .map((p) => (links.includes(p) ? textToHtml(p) : `<p style="margin:0 0 16px">${escapeHtml(p.trim()).replace(/\n/g, "<br>")}</p>`))
    .join("\n");
  return { subject, html: layout(html, foot.html), text: `${paragraphs.join("\n\n").trim()}\n\n--\n${foot.text}\n` };
}

const SIGNATURE = `Péter\n${SITE_NAME}`;

type Cities = readonly Pick<City, "slug" | "name">[];

export function signupConfirmation(s: InterestSignup, cities: Cities = []): Email {
  const otherCity = s.cityOther != null;
  const lines = [
    `Város: ${cityLabel(s, cities)}`,
    s.mode === "pair" && s.name2 ? `Párod: ${s.name2}` : "Egyedül jelentkeztél, párt keresel",
    `Szint: ${levelLabel(s.level)}`,
  ];
  const next = otherCity
    ? `Ott, ahol játszanál (${s.cityOther}), még nincs liga. Ha lesz szervező, és elég pár összegyűlik, szólunk.`
    : s.mode === "solo"
      ? "Segítünk párt találni. Amint elég pár összegyűlik, írunk az indulásról."
      : "Amint elég pár összegyűlik, írunk az indulásról és a következő lépésekről.";
  const share = otherCity
    ? `Minél többen jelentkeztek, annál hamarabb indulhat nálatok is. Küldd el a helyi padeleseknek: ${shareUrl(SHARE_REFS.email)}`
    : s.mode === "solo"
      ? `Minél többen jelentkeznek, annál könnyebb hozzád illő párt találni. Ha ismersz más padeleseket, küldd el nekik: ${shareUrl(SHARE_REFS.email)}`
      : `Ismersz még valakit, aki szívesen játszana? Küldd el neki: ${shareUrl(SHARE_REFS.email)}`;

  return build(
    `Megkaptuk a jelentkezésed – ${SITE_NAME}`,
    [
      `Szia ${s.name1}!`,
      `Köszi, megkaptuk a jelentkezésed.`,
      lines.join("\n"),
      next,
      share,
      `Ha valamit rosszul adtál meg, vagy meggondoltad magad, csak válaszolj erre a levélre.`,
      SIGNATURE,
    ].join("\n\n"),
    footer(`Azért kaptad ezt a levelet, mert jelentkeztél a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// Spec section 17: the partner gets exactly one email, so they know about the
// signup and can ask for deletion.
export function partnerNotice(s: InterestSignup, cities: Cities = []): Email {
  if (!s.name2) throw new Error("partnerNotice needs a partner");
  return build(
    `${s.name1} jelentkeztetett titeket a ${SITE_NAME}ra`,
    [
      `Szia ${s.name2}!`,
      `${s.name1} párként jelentkeztetett kettőtöket a ${SITE_NAME}ra (${cityLabel(s, cities)}), és megadta a neved és az e-mail-címed.`,
      `A ${SITE_NAME} pároknak szól: szint szerinti 4-es csoportok, heti egy meccs, feljutás és kiesés. Részletek: ${SITE_URL}`,
      `Ha nem tudsz róla, vagy nem szeretnéd, válaszolj erre a levélre, és töröljük az adataidat. Ezen kívül nem írunk neked, amíg magad nem regisztrálsz.`,
      SIGNATURE,
    ].join("\n\n"),
    footer(`Ezt az egy levelet azért kaptad, mert ${s.name1} megadta a címedet. Kapcsolat: ${CONTACT_EMAIL}`),
  );
}

// A Szervező paired two solo signups (app/lib/solo-pairing.ts): each gets one
// email with the other's name, level and email, so they can write to each
// other. Privacy page: "Ha egyedül jelentkezel".
export type PairIntroPerson = { name: string; email: string; level: string };

export function pairIntro(to: PairIntroPerson, partner: PairIntroPerson, city: string): Email {
  return build(
    `Találtunk neked párt – ${SITE_NAME}`,
    [
      `Szia ${to.name}!`,
      `Egyedül jelentkeztél a ${SITE_NAME}ra (${city}), és találtunk neked párt: ${partner.name}, aki szintén párt keres. A szintje: ${levelLabel(partner.level)}.`,
      `Az e-mail-címe: ${partner.email}\nŐ is megkapta a te nevedet és címedet. Írjatok egymásnak, játsszatok egyet, és ha összejön, az induláskor együtt neveztek.`,
      `Ha nem jön össze, vagy mégsem szeretnél vele játszani, válaszolj erre a levélre, és keresünk mást.`,
      SIGNATURE,
    ].join("\n\n"),
    footer(`Azért kaptad ezt a levelet, mert egyedül jelentkeztél a ${SITE_URL.replace("https://", "")} oldalon, és párt kerestél.`),
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

// The registration invite (#20) opens the login page with the address filled
// in (routes/login.tsx); the first login creates the account.
export function registrationLink(email: string): string {
  return `${SITE_URL}/login?email=${encodeURIComponent(email)}`;
}

// Sent once to everyone on the interest list (spec section 3). It goes to the
// whole list, so it has an unsubscribe link like a broadcast.
export function registrationInvite(to: { name: string; email: string }, unsubscribeUrl: string): Email {
  return build(
    `Regisztrálj a ${SITE_NAME}ra`,
    [
      `Szia ${to.name}!`,
      `Jelentkeztél a ${SITE_NAME}ra, és most már regisztrálhatsz. Az e-mail-címedet kitöltöttük, csak lépj be:`,
      registrationLink(to.email),
      `Jelszó nem kell: Google-lel vagy egy e-mailben kapott kóddal lépsz be.`,
      `Hamarosan itt hívhatod meg a párodat, és együtt nevezhettek a szezonra. Ha még nincs párod, válaszolj erre a levélre, és segítünk.`,
      SIGNATURE,
    ].join("\n\n"),
    footer(`Azért kaptad ezt a levelet, mert jelentkeztél a ${SITE_NAME}ra.`, unsubscribeUrl),
  );
}

// One-time login code (app/lib/auth). The code is in the subject too, so it
// shows in the phone's notification.
export function loginCode(code: string, validMinutes: number): Email {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
  return build(
    `${spaced} a belépőkódod – ${SITE_NAME}`,
    [
      `Szia!`,
      `A belépőkódod: ${spaced}`,
      `${validMinutes} percig érvényes, és csak egyszer használható.`,
      `Ha nem te kérted, nem kell tenned semmit: a kód nélkül senki nem tud belépni.`,
    ].join("\n\n"),
    footer(`Azért kaptad ezt a levelet, mert valaki ezzel a címmel kért belépőkódot a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// A player invites another to form a pair (#21). The invitee may have no
// account: then the link goes through the login page (lib/pairs.ts inviteLink).
export function pairInvite(
  input: { inviterName: string; league: string; link: string; hasAccount: boolean },
  unsubscribeUrl?: string,
): Email {
  return buildPlain(
    `${input.inviterName} meghívott párnak – ${SITE_NAME}`,
    [
      `Szia!`,
      `${input.inviterName} meghívott, hogy legyetek pár a ${SITE_NAME}on (${input.league}). Itt elfogadhatod, vagy jelezheted, hogy nem kéred:`,
      input.link,
      input.hasAccount
        ? null
        : `Ehhez be kell lépned. Jelszó nem kell: Google-lel vagy egy e-mailben kapott kóddal lépsz be, a címedet kitöltöttük.`,
      `Ha nem ismered, nem kell tenned semmit: más nem fogadhatja el helyetted.`,
      SIGNATURE,
    ].filter((p): p is string => p !== null),
    [input.link],
    footer(`Azért kaptad ezt a levelet, mert ${input.inviterName} megadta a címedet. Kapcsolat: ${CONTACT_EMAIL}`, unsubscribeUrl),
  );
}

// The inviter learns the answer (#21, D15): accepted or declined.
export function pairAnswer(input: { to: string; inviteeName: string; league: string; accepted: boolean }): Email {
  const pairPage = `${SITE_URL}/pair`;
  return buildPlain(
    input.accepted
      ? `${input.inviteeName} elfogadta a meghívásod – ${SITE_NAME}`
      : `${input.inviteeName} nem fogadta el a meghívásod – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      input.accepted
        ? `${input.inviteeName} elfogadta a meghívásod: mostantól pár vagytok (${input.league}). Ha megnyílik a nevezés, együtt nevezhettek a szezonra.`
        : `${input.inviteeName} most nem fogadta el a meghívásod (${input.league}). Meghívhatsz mást.`,
      pairPage,
      SIGNATURE,
    ],
    [pairPage],
    footer(`Azért kaptad ezt a levelet, mert párnak hívtál meg valakit a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// The partner learns the pair was dissolved (#85). Only the dissolving
// player's name, never their email or phone; the name stays plain text.
export function pairDissolved(input: { to: string; dissolverName: string; league: string }): Email {
  const pairPage = `${SITE_URL}/pair`;
  return buildPlain(
    `${input.dissolverName} megszüntette a párotokat – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `${input.dissolverName} megszüntette a párotokat (${input.league}). Új párt a Párom oldalon hívhatsz meg:`,
      pairPage,
      SIGNATURE,
    ],
    [pairPage],
    footer(`Azért kaptad ezt a levelet, mert pár voltatok a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// Both players learn the Szervező's decision on their season entry (#23),
// with the note if there is one. The note and the names stay plain text.
export function seasonEntryDecision(input: {
  to: string;
  partnerName: string;
  league: string;
  season: string;
  approved: boolean;
  // Where an approved pair starts; null: the next season.
  joins: { phase: number; startsAt: Date } | null;
  note: string | null;
}): Email {
  const pairPage = `${SITE_URL}/pair`;
  const where = `${input.season}, ${input.league}`;
  const start = !input.approved
    ? null
    : input.joins === null
      ? "A szezon utolsó köre már elindult, ezért a következő szezontól játszotok."
      : input.joins.phase === 1
        ? `Az 1. körtől játszotok (kezdés: ${formatShortDate(input.joins.startsAt)}). A csoportotokat a kör elején küldjük.`
        : `A szezon már elindult, ezért a ${input.joins.phase}. körtől játszotok (kezdés: ${formatShortDate(input.joins.startsAt)}). A csoportotokat a kör elején küldjük.`;
  return buildPlain(
    input.approved
      ? `Jóváhagyták a nevezéseteket – ${SITE_NAME}`
      : `Nem fogadták el a nevezéseteket – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      input.approved
        ? `A szervező jóváhagyta a nevezéseteket ${input.partnerName} pároddal (${where}).`
        : `A szervező most nem fogadta el a nevezéseteket ${input.partnerName} pároddal (${where}).`,
      start,
      input.note ? `A szervező üzenete:\n${input.note}` : null,
      `A nevezéseteket a Párom oldalon is látod:`,
      pairPage,
      SIGNATURE,
    ].filter((p): p is string => p !== null),
    [pairPage],
    footer(`Azért kaptad ezt a levelet, mert a pároddal neveztetek a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

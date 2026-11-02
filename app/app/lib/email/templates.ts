// Email content. Pure (no I/O) so it can be unit tested and previewed in the
// browser. Every email has an HTML and a plain-text version.

import type { City } from "../cities";
import { formatDeadline, formatOnDate, formatShortDate, formatUntilDate } from "../format";
import { withArticle } from "../groups";
import type { InterestSignup } from "../interest";
import { cityLabel, levelLabel } from "../signups-admin";
import { SHARE_REFS, shareUrl } from "../share";
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from "../site";

import type { InviteStart } from "./audience";

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
  // The other-city form asks for no partner (contact only).
  const lines = [
    `Város: ${cityLabel(s, cities)}`,
    ...(otherCity ? [] : [s.mode === "pair" && s.name2 ? `Párod: ${s.name2}` : "Egyedül jelentkeztél, párt keresel"]),
    `Szint: ${levelLabel(s.level)}`,
  ];
  const next = otherCity
    ? s.wantsToOrganize
      ? `Ott, ahol játszanál (${s.cityOther}), még nincs liga. Azt írtad, szívesen szerveznél: hamarosan írunk.`
      : `Ott, ahol játszanál (${s.cityOther}), még nincs liga. Ha lesz szervező, szólunk.`
    : s.mode === "solo"
      ? "Segítünk párt találni, és írunk az indulásról."
      : "Írunk az indulásról és a következő lépésekről.";
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
      `A ${SITE_NAME} pároknak szól: szint szerinti, 3-4 páros csoportok, heti egy meccs, feljutás és kiesés. Részletek: ${SITE_URL}`,
      // As on the privacy page: the registration invite is the only other email.
      `Ha nem tudsz róla, vagy nem szeretnéd, válaszolj erre a levélre, és töröljük az adataidat. Amikor indul a regisztráció, kapsz egy meghívót is. Ezen kívül semmit nem küldünk, amíg magad nem regisztrálsz.`,
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
      `Az e-mail-címe: ${partner.email}\nŐ is megkapta a te nevedet és címedet. Írjatok egymásnak, és játsszatok egyet. Ha összejön, a ligában párként neveztek.`,
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

// The registration invite (#20) opens the registration page with the
// address filled in (routes/register.tsx, the login flow); the first login
// creates the account. Invites sent before 2026-10-31 open /login, which
// works the same.
export function registrationLink(email: string): string {
  return `${SITE_URL}/register?email=${encodeURIComponent(email)}`;
}

// Sent once to everyone on the interest list (spec section 3). It goes to the
// whole list, so it has an unsubscribe link like a broadcast. It is the only
// email that thanks for signing up early (#131).
// `variant` (audience.ts, #96): a solo still waiting for a partner gets its
// own line; the signer of a pair signup without the partner's email is asked
// to add it on the first-login page (#130).
// `start` (audience.ts inviteStarts): when and where the league starts; null
// leaves that sentence out.
export function registrationInvite(
  to: { name: string; email: string; variant?: "solo" | "no_partner_email" },
  unsubscribeUrl: string,
  start: InviteStart | null = null,
): Email {
  const until = start?.registrationCloses ? `, a nevezés ${formatUntilDate(start.registrationCloses)} tart` : "";
  const when = start ? ` A liga ${formatOnDate(start.firstRound)} indul (${start.city})${until}.` : "";
  const together = "a ligában magától pár lesztek, és együtt nevezhettek a szezonra.";
  return build(
    `Regisztrálj a ${SITE_NAME}ra`,
    [
      `Szia ${to.name}!`,
      `Köszi, hogy előzetesen jelentkeztél a ${SITE_NAME}ra!${when} Regisztrálni és nevezni itt tudsz:`,
      registrationLink(to.email),
      `A neved és a szinted már megvan, csak a telefonszámod kell, úgyhogy egy perc az egész. Jelszó sem kell: Google-lel vagy egy e-mailben kapott kóddal lépsz be.`,
      to.variant === "solo"
        ? `Még keresünk neked párt, addig regisztrálj.`
        : to.variant === "no_partner_email"
          ? `A párod e-mail-címét nem adtad meg: belépéskor add meg, és ő is kap meghívót. Amint ő is regisztrál, ${together}`
          : `Amint a párod is regisztrál, ${together}`,
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
      SIGNATURE,
    ].join("\n\n"),
    footer(`Azért kaptad ezt a levelet, mert valaki ezzel a címmel kért belépőkódot a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// Both players learn that their season entry counts (#153): one of them
// clicked "Nevezünk". The names stay plain text.
export function seasonEntered(input: {
  to: string;
  partnerName: string;
  league: string;
  season: string;
  // Where the pair starts; null: the next season.
  joins: { phase: number; startsAt: Date } | null;
}): Email {
  const pairPage = `${SITE_URL}/pair`;
  const where = `${input.season}, ${input.league}`;
  const start =
    input.joins === null
      ? "A szezon utolsó köre már elindult, ezért a következő szezontól játszotok."
      : `${input.joins.phase === 1 ? "Az" : "A"} ${input.joins.phase}. körtől játszotok (kezdés: ${formatShortDate(input.joins.startsAt)}). A csoportotokat a kör elején küldjük.`;
  return buildPlain(
    `Beneveztetek – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `Beneveztetek ${input.partnerName} pároddal (${where}).`,
      start,
      `A nevezéseteket a Párom oldalon is látod:`,
      pairPage,
      SIGNATURE,
    ],
    [pairPage],
    footer(`Azért kaptad ezt a levelet, mert a pároddal neveztetek a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// The groups are published (#24, D22): each player gets their group, the
// pair they play each week (names only, never an email or phone) and the
// deadline. Names stay plain text.
export function groupsPublished(input: {
  to: string;
  partnerName: string;
  league: string;
  season: string;
  phase: number;
  group: number;
  // One per week: the date range and the opponents' two names, or null for
  // the rest week of a group of 3.
  weeks: { week: number; range: string; opponents: [string, string] | null }[];
  deadline: Date;
}): Email {
  const home = `${SITE_URL}/home`;
  const schedule = input.weeks
    .map((w) => `${w.week}. hét (${w.range}): ${w.opponents ? `${w.opponents.join(" és ")} ellen` : "pihenőhét"}`)
    .join("\n");
  return buildPlain(
    `Itt a csoportod: ${input.group}. csoport – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `Kész ${withArticle(input.phase)} kör csoportbeosztása (${input.season}, ${input.league}). ${input.partnerName} pároddal ${withArticle(input.group)} csoportban játszotok.`,
      `A meccseitek:\n${schedule}`,
      `Határidő: ${formatDeadline(input.deadline)}. Addig bármikor lejátszhatjátok a meccseket, de érdemes a kiírt héten.`,
      // #26 requirement 7: the link leads to the matches, each with the
      // short scheduling guide.
      `Az időpontot az oldalon egyeztetitek:`,
      home,
      SIGNATURE,
    ],
    [home],
    footer(`Azért kaptad ezt a levelet, mert a pároddal neveztetek a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

type MatchEmailInput = {
  to: string;
  // The other pair's two names ("Kiss Anna és Nagy Béla").
  opponents: string;
  matchId: number;
  week: number;
  deadline: Date;
  venue: string | null;
};

const matchFooter = () =>
  footer(`Azért kaptad ezt a levelet, mert a pároddal játszol a ${SITE_URL.replace("https://", "")} ligájában. Az értesítéseket a profilodban állíthatod be.`);

// A proposal or counter-proposal arrived (#26, spec 13): the slots and a
// one-tap link to answer. Names stay plain text.
export function matchProposal(input: MatchEmailInput & { counter: boolean; slots: Date[] }): Email {
  const link = `${SITE_URL}/matches/${input.matchId}`;
  return buildPlain(
    `${input.counter ? "Új időpontokat" : "Időpontokat"} ajánlottak a meccsetekre – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `${input.opponents} ${input.counter ? "új időpontokat" : "időpontokat"} ajánlott a ${input.week}. heti meccsetekre:\n${input.slots.map((s) => formatDeadline(s)).join("\n")}`,
      input.venue ? `Helyszín: ${input.venue}` : null,
      `Válassz egyet, vagy ajánlj másikat (határidő: ${formatDeadline(input.deadline)}):`,
      link,
      SIGNATURE,
    ].filter((p): p is string => p !== null),
    [link],
    matchFooter(),
  );
}

// A result waits for confirmation (#28, spec 7 and 13): the score from the
// recipient's side and a one-tap link to the match page, where confirming is
// the first button.
export function matchResult(input: MatchEmailInput & { score: string; autoAcceptAt: Date }): Email {
  const link = `${SITE_URL}/matches/${input.matchId}#eredmeny`;
  return buildPlain(
    `Erősítsd meg a meccs eredményét – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `${input.opponents} rögzítette a ${input.week}. heti meccsetek eredményét (ti vagytok elöl): ${input.score}.`,
      `Erősítsd meg, vagy jelezd, ha nem így volt:`,
      link,
      `Ha ${formatDeadline(input.autoAcceptAt)}-ig nem válaszoltok, magától elfogadjuk.`,
      SIGNATURE,
    ],
    [link],
    matchFooter(),
  );
}

// An agreed time waits for confirmation (#26, spec 6.3 and 13).
export function matchAgreedTime(input: MatchEmailInput & { slot: Date }): Email {
  const link = `${SITE_URL}/matches/${input.matchId}`;
  return buildPlain(
    `Erősítsd meg a meccs időpontját – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `${input.opponents} rögzítette a ${input.week}. heti meccsetek megbeszélt időpontját: ${formatDeadline(input.slot)}.`,
      input.venue ? `Helyszín: ${input.venue}` : null,
      `Erősítsd meg, vagy jelezd, ha nem így beszéltétek:`,
      link,
      SIGNATURE,
    ].filter((p): p is string => p !== null),
    [link],
    matchFooter(),
  );
}

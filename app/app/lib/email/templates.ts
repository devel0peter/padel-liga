// Email content. Pure (no I/O) so it can be unit tested and previewed in the
// browser. Every email has an HTML and a plain-text version.

import { formatDeadline, formatShortDate, formatWeekdayDate } from "../format";
import { withArticle } from "../groups";
import { PAIR_SECTION_PATH } from "../pairs";
import { SITE_NAME, SITE_URL } from "../site";

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

// An organizer put two registered players in a pair (Párkeresők, Párok or
// "Partner cseréje", #260): each gets the partner's name, address and phone
// (D121, so two strangers can reach each other; phone formatted, "" when
// none) and the way to Párod, where they enter the season. Names stay plain
// text.
export function pairCreated(input: {
  to: string;
  partnerName: string;
  partnerEmail: string;
  partnerPhone: string;
  league: string;
}): Email {
  const pairPage = `${SITE_URL}${PAIR_SECTION_PATH}`;
  const contact = [`E-mail: ${input.partnerEmail}`, ...(input.partnerPhone ? [`Telefon: ${input.partnerPhone}`] : [])];
  return buildPlain(
    `Van párod – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `A szervező párba tett: a párod ${input.partnerName} (${input.league}).`,
      [`Így éred el:`, ...contact].join("\n"),
      `Beszéljétek meg, és nevezzetek a szezonra a Profil oldalon (ott is megtalálod az elérhetőségét):`,
      pairPage,
      `Ha valami nem stimmel, válaszolj erre a levélre.`,
      SIGNATURE,
    ],
    [pairPage],
    footer(`Azért kaptad ezt a levelet, mert a szervező párba tett a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// A player's 2nd strike (#294, spec 8 and 13): the warning. Says what a 3rd
// one means and that the organizer can cancel a strike with a reason. No
// other player is named.
export function strikeWarning(input: { to: string; league: string; season: string }): Email {
  const home = `${SITE_URL}/home`;
  return buildPlain(
    `Figyelmeztetés: 2. fekete pont – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `Megkaptad a 2. fekete pontodat ebben a szezonban (${input.season}, ${input.league}). Fekete pont jár, ha a határidőig nem próbáltatok egyeztetni, ha 24 órán belül lemondtátok az időpontot és nem pótoltátok, vagy ha nem jelentetek meg.`,
      `Ha lesz egy 3., a párod és te a kör végén kikerültök a ligából. A következő szezonban újra nevezhettek, akkor a fekete pontok is nullázódnak.`,
      `Ha betegség vagy a pálya lemondása miatt kaptad, írj a szervezőnek: indokkal törölheti.`,
      home,
      SIGNATURE,
    ],
    [home],
    footer(`Azért kaptad ezt a levelet, mert játszol a ${SITE_URL.replace("https://", "")} ligájában.`),
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
  // Where the pair starts; null: the next season; startsAt null: a first
  // season still waiting for its minimum entries (D124).
  joins: { phase: number; startsAt: Date | null } | null;
}): Email {
  const pairPage = `${SITE_URL}${PAIR_SECTION_PATH}`;
  const where = `${input.season}, ${input.league}`;
  const start =
    input.joins === null
      ? "A szezon utolsó köre már elindult, ezért a következő szezontól játszotok."
      : input.joins.startsAt === null
        ? "A szezon akkor indul, ha elég pár nevezett. Amint összegyűlnek, megírjuk, mikor kezdődik az 1. kör."
        : `${input.joins.phase === 1 ? "Az" : "A"} ${input.joins.phase}. körtől játszotok (kezdés: ${formatShortDate(input.joins.startsAt)}). A csoportotokat a kör elején küldjük.`;
  return buildPlain(
    `Beneveztetek – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `Beneveztetek ${input.partnerName} pároddal (${where}).`,
      start,
      `A nevezéseteket a Profil oldalon is látod:`,
      pairPage,
      SIGNATURE,
    ],
    [pairPage],
    footer(`Azért kaptad ezt a levelet, mert a pároddal neveztetek a ${SITE_URL.replace("https://", "")} oldalon.`),
  );
}

// A league's first season reached its minimum entries (D124, #335): every
// entered player learns when round 1 starts and that the groups come out by
// that morning. Names only the recipient.
export function seasonStart(input: { to: string; league: string; season: string; start: Date }): Email {
  const home = `${SITE_URL}/home`;
  const day = formatWeekdayDate(input.start);
  return buildPlain(
    `Indul a szezon: ${day} – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `Összegyűlt elég nevezés, így eldőlt, mikor indul a szezon (${input.season}, ${input.league}).`,
      `Az 1. kör kezdete: ${day}. A csoportbeosztást legkésőbb aznap reggel megkapjátok e-mailben és az oldalon.`,
      `A kezdést a Kezdőlapon is látod:`,
      home,
      SIGNATURE,
    ],
    [home],
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

export type StuckReminderInput = {
  // reminders.ts: B first login not finished, C no pair, D no entry.
  situation: "B" | "C" | "D";
  to: string;
  // D: the other player. Names only.
  partner: string | null;
  league: string;
  season: string;
  deadline: Date;
  // The next phase that hasn't started.
  nextRound: { number: number; startsAt: Date } | null;
  // C: the player's own pair link, in full.
  pairLink: string | null;
  now: Date;
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// The dates every reminder gives (#155): the registration deadline and the
// next round's start; after the deadline (late entry) only the round.
function reminderDates(input: StuckReminderInput, plural: boolean): string {
  const round = input.nextRound
    ? `${withArticle(input.nextRound.number)} kör ${formatWeekdayDate(input.nextRound.startsAt)} indul`
    : null;
  if (input.deadline > input.now)
    return `Nevezési határidő: ${formatDeadline(input.deadline)}.${round ? ` ${capitalize(round)}.` : ""}`;
  return `A határidő lejárt, de még ${plural ? "beszállhattok" : "beszállhatsz"}${round ? `: ${round}` : ""}.`;
}

// One automatic reminder per situation for someone stuck before entering a
// season (#155). Names stay plain text; another person's email or phone is
// never in it. Like every mail to many, it has an unsubscribe link.
export function stuckReminder(input: StuckReminderInput, unsubscribeUrl: string): Email {
  const hi = input.to.trim() ? `Szia ${input.to.trim()}!` : "Szia!";
  const pairPage = `${SITE_URL}${PAIR_SECTION_PATH}`;
  const registered = `Azért kaptad ezt a levelet, mert regisztráltál a ${SITE_URL.replace("https://", "")} oldalon.`;
  const parts = (() => {
    switch (input.situation) {
      case "B": {
        const login = `${SITE_URL}/login`;
        return {
          subject: `Fejezd be a regisztrációt – ${SITE_NAME}`,
          paragraphs: [
            hi,
            `Elkezdted a regisztrációt a ${SITE_NAME}on, de még nem fejezted be. Lépj be, és add meg a neved, a szinted és a telefonszámod:`,
            login,
            reminderDates(input, false),
          ],
          links: [login],
          reason: registered,
        };
      }
      case "C": {
        const link = input.pairLink ?? pairPage;
        return {
          subject: `Hívd meg a párodat – ${SITE_NAME}`,
          paragraphs: [
            hi,
            `Még nincs párod (${input.league}). A „Hívd meg a párodat” kártyán van a saját linked: küldd el a párodnak. Ha megnyitja és regisztrál, párban vagytok, és nevezhettek.`,
            link,
            `Ha nincs kivel játszanod, a Profil oldalon kapcsold be a „Párt keresek” kapcsolót, és a szervező keres neked párt:`,
            pairPage,
            reminderDates(input, false),
          ],
          links: [link, pairPage],
          reason: registered,
        };
      }
      case "D":
        return {
          subject: `Nevezzetek a szezonra – ${SITE_NAME}`,
          paragraphs: [
            hi,
            `${input.partner ?? "A"} pároddal még nem neveztetek (${input.season}, ${input.league}). Egyikőtök nyomja meg a „Nevezünk” gombot a Profil oldalon:`,
            pairPage,
            reminderDates(input, true),
          ],
          links: [pairPage],
          reason: registered,
        };
    }
  })();
  return buildPlain(
    parts.subject,
    [...parts.paragraphs.filter((p): p is string => p !== null), SIGNATURE],
    parts.links,
    footer(parts.reason, unsubscribeUrl),
  );
}

// The daily digest (#31, spec 13): one email in the morning with the match
// news and reminders of the last day the player hasn't opened in the app yet,
// each with its one-tap link. The items are the in-app notifications' own
// texts (no names), so a new digest kind needs nothing here.
export function dailyDigest(input: { to: string; items: { title: string; body: string; url: string }[] }): Email {
  const links = input.items.map((i) => `${SITE_URL}${i.url}`);
  const lines = input.items.flatMap((i, n) => [`${i.title}\n${i.body}`, links[n]!]);
  return buildPlain(
    `${input.items.length === 1 ? input.items[0]!.title : `Napi összefoglaló: ${input.items.length} újdonság`} – ${SITE_NAME}`,
    [`Szia ${input.to}!`, "Ez történt a meccseiddel, és ez vár rád:", ...lines, SIGNATURE],
    links,
    matchFooter(),
  );
}

// The evening before an accepted slot (#31, spec 13: instant): time, venue
// and the opponents, with the match page.
export function matchTomorrow(input: { to: string; opponents: string; matchId: number; slot: Date; venue: string | null }): Email {
  const link = `${SITE_URL}/matches/${input.matchId}`;
  return buildPlain(
    `Holnap meccs: ${formatDeadline(input.slot)} – ${SITE_NAME}`,
    [
      `Szia ${input.to}!`,
      `Holnap játszotok ${input.opponents} ellen: ${formatDeadline(input.slot)}.`,
      input.venue ? `Helyszín: ${input.venue}` : "A helyszínt még nem rögzítettétek: aki foglalt pályát, írja be az oldalon.",
      `A meccs oldala:`,
      link,
      SIGNATURE,
    ],
    [link],
    matchFooter(),
  );
}

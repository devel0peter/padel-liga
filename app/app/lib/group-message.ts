// "Írj mindenkinek" (D147): one tap to write to the match's other three
// players, the partner and the two opponents, from the phone's own SMS or
// email app. The app sends nothing; these build the links and the text.
// Pure (no I/O).

import { dialable } from "./matches";

export type SmsPlatform = "ios" | "android";

// iOS takes several SMS recipients only as `sms:/open?addresses=…`; Android
// (and the server, before the browser says which) `sms:<numbers>?body=…`.
// iPadOS reports a Mac: one with a touch screen is an iPad.
export function smsPlatform(userAgent: string, maxTouchPoints = 0): SmsPlatform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return "ios";
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "android";
}

// The SMS app with every number (E.164, no spaces) and the text; null
// without a number.
export function smsHref(phones: readonly string[], body: string, platform: SmsPlatform): string | null {
  const numbers = phones.map(dialable).filter(Boolean);
  if (numbers.length === 0) return null;
  const text = encodeURIComponent(body);
  return platform === "ios" ? `sms:/open?addresses=${numbers.join(",")}&body=${text}` : `sms:${numbers.join(",")}?body=${text}`;
}

// The email app with every address, the subject and the text; null without
// an address. The `@` stays readable, everything else is encoded.
export function mailtoHref(emails: readonly string[], subject: string, body: string): string | null {
  const to = emails.filter(Boolean).map((e) => encodeURIComponent(e).replace(/%40/g, "@"));
  if (to.length === 0) return null;
  return `mailto:${to.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export const messageSubject = (week: number) => `Padelpárbaj: ${week}. heti meccs`;

// The text: who writes about which match, and the reminder to record the time
// in the app too (the strikes and "who tried" are read from the match log).
// `us`, `them`: the two pairs' names, the writer's pair first; `url`: the
// match page, absolute.
export function messageText(m: { week: number; us: readonly string[]; them: readonly string[]; url: string }): string {
  return (
    `Szia! A Padelpárbaj ${m.week}. heti meccsünkről írok (${m.us.join(" és ")} – ${m.them.join(" és ")}). ` +
    `Mikor értek rá? Ha megvan az időpont, rögzítsük az appban is: ${m.url}`
  );
}

export type Recipient = { name: string; phone: string; email: string | null };

// Everything the three controls need: the links (SMS null without any
// number, email null without any address), the numbers to copy as shown,
// and who can't be reached that way.
export function groupMessage(
  recipients: readonly Recipient[],
  text: { week: number; us: readonly string[]; them: readonly string[]; url: string },
  platform: SmsPlatform,
) {
  const body = messageText(text);
  const withPhone = recipients.filter((r) => dialable(r.phone));
  const withEmail = recipients.filter((r) => r.email);
  return {
    sms: smsHref(withPhone.map((r) => r.phone), body, platform),
    mailto: mailtoHref(withEmail.map((r) => r.email!), messageSubject(text.week), body),
    phones: withPhone.map((r) => r.phone).join(", "),
    noPhone: recipients.filter((r) => !dialable(r.phone)).map((r) => r.name),
    noEmail: recipients.filter((r) => !r.email).map((r) => r.name),
  };
}

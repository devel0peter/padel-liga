// What "Kimenő levelek" (/admin/outbox) shows: the log of every email kind
// (#112; the held outbox of #88 is gone). Pure (no I/O).
import { CONTACT_EMAIL } from "~/lib/site";

import type { MessageKind } from "./budget";

// Names on the outbox page. Partial, so a new kind needs no entry here: it
// shows under its code name until one is added.
const KIND_LABELS: Partial<Record<MessageKind, string>> = {
  login_code: "Belépőkód",
  signup_confirmation: "Jelentkezés visszaigazolása",
  partner_notice: "Szólunk a megadott párnak",
  broadcast: "Körlevél",
  pair_intro: "Párkeresők bemutatása",
  registration_invite: "Regisztrációs meghívó",
  pair_invite: "Pármeghívó",
  pair_answer: "Válasz a pármeghívóra",
  pair_dissolved: "Megszűnt a pár",
  season_entry_decision: "Döntés a nevezésről",
  groups_published: "Kihirdetett csoportok",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as MessageKind] ?? kind;
}

export const HIDDEN = "[elrejtve]";

// A link parameter that carries an address: the login link's ?email= and
// the unsubscribe link's ?t= (base64 of the address).
const ADDRESS_PARAM = /([?&](?:email|t)=)[^\s&#"'<>)]+/gi;
// A percent-encoded address anywhere else.
const ENCODED_ADDRESS = /[^\s"'<>()=&?/]*%40[^\s"'<>()&#]*/gi;
const ADDRESS = /[^\s<>()[\]:;,@"']+@(?:[^\s<>()[\]:;,@"'.]+\.)+[^\s<>()[\]:;,@"'.]{2,}/g;

// The outbox page shows no email address: not in a failure reason (an SMTP
// reply may quote the recipient), not in a text (a pair intro carries the
// partner's). Our own contact address stays.
export function hideAddresses(text: string): string {
  return text
    .replace(ADDRESS_PARAM, `$1${HIDDEN}`)
    .replace(ENCODED_ADDRESS, HIDDEN)
    .replace(ADDRESS, (a) => (a.toLowerCase() === CONTACT_EMAIL ? a : HIDDEN));
}

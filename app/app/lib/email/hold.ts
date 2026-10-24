// The held outbox (#88, README decision log 2026-10-24): only login codes and
// signup confirmations go out by themselves; every other email waits as
// "held" until an Admin sends or discards it on /admin/outbox. Pure (no I/O).
import { emailMessages } from "~/db/schema";
import { CONTACT_EMAIL } from "~/lib/site";

import type { MessageKind } from "./budget";

// An allowlist, so a kind added later is held by default (D23).
export const AUTOMATIC_KINDS = ["login_code", "signup_confirmation"] as const satisfies readonly MessageKind[];

export function isAutomatic(kind: string): boolean {
  return (AUTOMATIC_KINDS as readonly string[]).includes(kind);
}

// The status a new email is stored with.
export function queuedStatus(kind: MessageKind): "pending" | "held" {
  return isAutomatic(kind) ? "pending" : "held";
}

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
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind as MessageKind] ?? kind;
}

// A kind from a form field: one the email table knows, else null.
export function parseKind(value: FormDataEntryValue | null): MessageKind | null {
  const kinds: readonly string[] = emailMessages.kind.enumValues;
  return typeof value === "string" && kinds.includes(value) ? (value as MessageKind) : null;
}

export const HIDDEN = "[elrejtve]";

// A link parameter that carries an address: the login link's ?email= and
// the unsubscribe link's ?t= (base64 of the address).
const ADDRESS_PARAM = /([?&](?:email|t)=)[^\s&#"'<>)]+/gi;
// A percent-encoded address anywhere else.
const ENCODED_ADDRESS = /[^\s"'<>()=&?/]*%40[^\s"'<>()&#]*/gi;
const ADDRESS = /[^\s<>()[\]:;,@"']+@(?:[^\s<>()[\]:;,@"'.]+\.)+[^\s<>()[\]:;,@"'.]{2,}/g;

// The preview on the outbox page shows no email address: not the
// recipient's, and not one inside the text (a pair intro carries the
// partner's). Our own contact address stays.
export function hideAddresses(text: string): string {
  return text
    .replace(ADDRESS_PARAM, `$1${HIDDEN}`)
    .replace(ENCODED_ADDRESS, HIDDEN)
    .replace(ADDRESS, (a) => (a.toLowerCase() === CONTACT_EMAIL ? a : HIDDEN));
}

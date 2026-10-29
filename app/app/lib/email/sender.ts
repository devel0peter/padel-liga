// Who our emails come from, whichever provider sends them. Pure (no I/O).

// A real, read mailbox (Google Workspace): people do answer these emails,
// and providers advise against noreply senders.
export const SENDER = { name: "Péter, Padelpárbaj", address: "hello@padelparbaj.hu" } as const;
export const REPLY_TO = "hello@padelparbaj.hu";
// Our name in the SMTP greeting and the domain of our Message-IDs.
export const SENDER_DOMAIN = "padelparbaj.hu";

export type OutgoingEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
};

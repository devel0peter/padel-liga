// Sharing the landing page after a signup (signup form, confirmation email).
// Pure. Each place has its own `?ref=`, so /admin/traffic shows what the
// shares bring in.

import { SITE_URL } from "./site";

export const SHARE_REFS = { page: "megosztas", email: "megosztas-email" } as const;

export function shareUrl(ref: string): string {
  return `${SITE_URL}/?ref=${encodeURIComponent(ref)}`;
}

// The message that goes with the link. A solo player asks for a partner.
// The city stays in brackets: its suffix ("Győrben", "Pécsen") can't be built.
export function shareText(mode: "pair" | "solo", city: string | null): string {
  const where = city ? ` (${city})` : "";
  return mode === "solo"
    ? `Párt keresek a Padelpárbajra${where}, heti padel ligára pároknak. Gyere velem, vagy jelentkezz te is:`
    : `Indul a Padelpárbaj${where}, heti padel liga pároknak. Jelentkezz te is:`;
}

export function shareLinks(url: string, text: string): { whatsapp: string; facebook: string } {
  return {
    whatsapp: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
  };
}

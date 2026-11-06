import { Phone } from "lucide-react";

import { telHref } from "~/lib/matches";
import { cn } from "~/lib/utils";

// A player's phone number on an organizer page (D126): tap to call. Only on
// pages behind `league.manage` or the Admin's; never on a public page.
// Nothing when the player has no number (the "Nincs telefonszáma" chip says so).
export function PhoneLink({ phone, className }: { phone: string; className?: string }) {
  if (!phone) return null;
  return (
    <a href={telHref(phone)} className={cn("inline-flex items-center gap-1 text-sm whitespace-nowrap underline", className)}>
      <Phone className="size-3.5 shrink-0" aria-hidden />
      {phone}
    </a>
  );
}
